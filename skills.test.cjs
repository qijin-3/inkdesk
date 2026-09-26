const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Skills, SKILLS_ROOT } = require("./skills.cjs");

function vaultStub(root) {
  return {
    p: (r) => path.join(root, r),
    resolveAccountId: (a) => a,
  };
}

function writePack(dir, name, description) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

test("vault .agents/skills scan, symlink mount, drop legacy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aside-skills-"));
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), "aside-mount-"));
  try {
    const k = new Skills(vaultStub(root));
    fs.mkdirSync(path.dirname(k.file), { recursive: true });
    fs.writeFileSync(
      k.file,
      JSON.stringify({
        revision: 2,
        items: [
          {
            id: "old",
            name: "旧",
            scope: "global",
            prompt: "x",
            includes: [],
          },
        ],
        accounts: { A: ["old"] },
      }),
    );
    let s = k.list("A");
    assert.equal(s.items.length, 0);
    assert.deepEqual(s.accounts, {});
    assert.equal(s.root, SKILLS_ROOT);

    s = k.create({
      account: "A",
      revision: s.revision,
      name: "fact-check",
      description: "核实来源",
    });
    assert.ok(
      fs.existsSync(path.join(root, ".agents/skills/fact-check/SKILL.md")),
    );

    const src = path.join(root, "incoming", "my-voice");
    writePack(src, "my-voice", "保留语气");
    s = k.import({
      account: "A",
      revision: s.revision,
      sourcePath: src,
      group: "writing",
    });
    assert.ok(
      fs.existsSync(
        path.join(root, ".agents/skills/writing/my-voice/SKILL.md"),
      ),
    );
    assert.equal(s.tree.length, 2);
    assert.ok(s.tree.some((g) => g.group === "writing"));

    s = k.configure({
      account: "A",
      revision: s.revision,
      ids: ["fact-check", "writing/my-voice"],
    });
    const mounted = k.mount("A", undefined, mount);
    assert.equal(mounted.length, 2);
    assert.match(k.contextPrompt(mounted), /\.agents\/skills/);
    assert.ok(!fs.existsSync(path.join(mount, ".claude/skills")));
    const link = path.join(mount, ".agents/skills/fact-check");
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(
      fs.realpathSync(link),
      fs.realpathSync(path.join(root, ".agents/skills/fact-check")),
    );

    s = k.remove({
      account: "A",
      revision: s.revision,
      id: "writing/my-voice",
    });
    assert.equal(s.items.some((x) => x.id === "writing/my-voice"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(mount, { recursive: true, force: true });
  }
});
