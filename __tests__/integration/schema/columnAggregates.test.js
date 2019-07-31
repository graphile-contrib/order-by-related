const core = require("./core");

test(
  "prints a schema with the order-by-related plugin",
  core.test(["p"], {
    appendPlugins: [require("../../../index.js")],
    disableDefaultMutations: true,
    legacyRelations: "omit",
    graphileBuildOptions: {
      orderByRelatedColumnAggregates: true,
    },
  })
);
