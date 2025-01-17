// @ts-check
const pg = require("pg");
const { readFile } = require("fs");

// This test suite can be flaky. Increase it’s timeout.
jest.setTimeout(1000 * 20);

function readFilePromise(filename, encoding) {
  return new Promise((resolve, reject) => {
    readFile(filename, encoding, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

const withPgClient = async (url, fn) => {
  if (!fn) {
    fn = url;
    url = process.env.TEST_DATABASE_URL;
  }
  const pgPool = new pg.Pool({ connectionString: url });
  let client;
  try {
    client = await pgPool.connect();
    await client.query("begin");
    await client.query("set local timezone to '+04:00'");
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } finally {
    try {
      await client.release();
    } catch (e) {
      console.error("Error releasing pgClient", e); // eslint-disable-line no-console
    }
    await pgPool.end();
  }
};

const withDbFromUrl = async (url, fn) => {
  return withPgClient(url, async (client) => {
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE;");
      return fn(client);
    } finally {
      await client.query("COMMIT;");
    }
  });
};

const withRootDb = (fn) => withDbFromUrl(process.env.TEST_DATABASE_URL, fn);

/** @type {(Promise<void> & {resolve: () => void, reject: () => void, client: import('pg').PoolClient, vars: any}) | null} */
let prepopulatedDBKeepalive = null;

const populateDatabase = async (client) => {
  await client.query(await readFilePromise(`${__dirname}/p-data.sql`, "utf8"));
  return {};
};

const withPrepopulatedDb = async (fn) => {
  if (!prepopulatedDBKeepalive) {
    throw new Error("You must call setup and teardown to use this");
  }
  const { client, vars } = prepopulatedDBKeepalive;
  if (!vars) {
    throw new Error("No prepopulated vars");
  }
  let err;
  try {
    await fn(client, vars);
  } catch (e) {
    err = e;
  }
  try {
    await client.query("ROLLBACK TO SAVEPOINT pristine;");
  } catch (e) {
    err = err || e;
    console.error("ERROR ROLLING BACK", e.message); // eslint-disable-line no-console
  }
  if (err) {
    throw err;
  }
};

withPrepopulatedDb.setup = (done) => {
  if (prepopulatedDBKeepalive) {
    throw new Error("There's already a prepopulated DB running");
  }
  let res;
  let rej;
  withRootDb(async (client) => {
    prepopulatedDBKeepalive = Object.assign(
      new Promise((resolve, reject) => {
        res = resolve;
        rej = reject;
      }),
      { resolve: res, reject: rej, client, vars: undefined }
    );
    try {
      prepopulatedDBKeepalive.vars = await populateDatabase(client);
    } catch (e) {
      console.error("FAILED TO PREPOPULATE DB!", e.message); // eslint-disable-line no-console
      return done(e);
    }
    await client.query("SAVEPOINT pristine;");
    done();
    return prepopulatedDBKeepalive;
  });
};

withPrepopulatedDb.teardown = () => {
  if (!prepopulatedDBKeepalive) {
    throw new Error("Cannot tear down null!");
  }
  prepopulatedDBKeepalive.resolve(); // Release DB transaction
  prepopulatedDBKeepalive = null;
};

exports.withRootDb = withRootDb;
exports.withPrepopulatedDb = withPrepopulatedDb;
exports.withPgClient = withPgClient;
