require("dotenv").config();
const { initSchema, closeDb } = require("./db");

initSchema()
  .then(() => console.log("Database schema is ready."))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

