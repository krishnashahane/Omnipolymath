import "../test/helpers/postgres-pool-roots-preload.mjs";
import { setEnvironmentData } from "node:worker_threads";

const connection = new URL(import.meta.url).searchParams.get("connection");
if (!connection) {
  throw new Error("Database conformance preload requires a connection");
}
setEnvironmentData("omnipolymath.test.workboard.connection", connection);
setEnvironmentData("omnipolymath.test.state.conformance.connection", connection);
