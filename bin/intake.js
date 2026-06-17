#!/usr/bin/env node
import { main } from "../src/cli.js";
import { loadDotEnvFiles } from "../src/secrets.js";

loadDotEnvFiles();
main(process.argv.slice(2)).catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
