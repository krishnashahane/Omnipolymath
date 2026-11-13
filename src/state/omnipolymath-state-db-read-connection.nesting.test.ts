import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { closeOmnipolymathStateDatabaseAsync } from "./omnipolymath-state-db-cache.js";
import {
  closeRetainedOmnipolymathStateReadConnections,
  withOmnipolymathStateReadOnlyLocation,
} from "./omnipolymath-state-db-read-connection.js";
import type { OmnipolymathStateReadOnlyDatabase } from "./omnipolymath-state-read.types.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    closeRetainedOmnipolymathStateReadConnections();
    await closeOmnipolymathStateDatabaseAsync();
    cleanup();
  }),
);

function fixture() {
  const root = tempDirs.make("omnipolymath-nested-state-reader-");
  const pathname = path.join(root, "state.sqlite");
  const seed = openNodeSqliteDatabase(pathname);
  seed.exec("CREATE TABLE sample (value INTEGER); INSERT INTO sample VALUES (1)");
  seed.close();
  const read = <T>(operation: (database: OmnipolymathStateReadOnlyDatabase) => T) =>
    withOmnipolymathStateReadOnlyLocation(
      operation,
      pathname,
      pathname,
      undefined,
      undefined,
      undefined,
      true,
    );
  const value = () => read(({ db }) => db.prepare("SELECT value FROM sample").get()?.value);
  return { read, value };
}

it("settles nested readers without closing the caller's retained handle", () => {
  const { read, value } = fixture();
  const operation = ({ db }: OmnipolymathStateReadOnlyDatabase) => {
    const nestedReaders: OmnipolymathStateReadOnlyDatabase["db"][] = [];
    expect(
      read(({ db: nested }) => {
        nestedReaders.push(nested);
        return nested.prepare("SELECT value FROM sample").get()?.value;
      }),
    ).toBe(1);
    expect(() =>
      read(({ db: nested }) => {
        nestedReaders.push(nested);
        throw new Error("nested read failed");
      }),
    ).toThrow("nested read failed");
    expect(db.prepare("SELECT value FROM sample").get()?.value).toBe(1);
    expect(nestedReaders.map((nested) => nested.isOpen)).toEqual([false, false]);
  };
  read(operation);
  expect(value()).toBe(1);
});
