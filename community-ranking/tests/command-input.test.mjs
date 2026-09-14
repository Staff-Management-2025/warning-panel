import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/command-input.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { commandUsername, completeUsername } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("username suggestions remain available while a role number, ID, or all is already typed", () => {
  for (const command of ["AddRole Adr", "AddRole Adr 7", "RemoveRole Adr 682961014", "Remove Role Adr all", "Check Roles Adr "])
    assert.equal(commandUsername(command), "Adr");
  for (const command of ["RemoveRole all all", "AddRole all 7", "AddRole username 7", "AddRole A", "RestoreRank", "AddRole Bad;Name 7"])
    assert.equal(commandUsername(command), "");
  assert.equal(completeUsername("AddRole Adr 7", "AdrianAspher"), "AddRole AdrianAspher 7");
  assert.equal(completeUsername("Remove Role Adr all", "AdrianAspher"), "Remove Role AdrianAspher all");
  assert.equal(completeUsername("Check Roles Adr", "AdrianAspher"), "Check Roles AdrianAspher ");
});
