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

test("vault .agents/skills scan, symlink mount, bindings", () => {
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
    assert.deepEqual(s.bindings, {});
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
    assert.equal(s.bindings["fact-check"], "all");

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
      id: "writing/my-voice",
      binding: ["A"],
    });
    assert.deepEqual(s.bindings["writing/my-voice"], ["A"]);
    assert.equal(s.bindings["fact-check"], "all");
    assert.ok(s.accounts.A.includes("fact-check"));
    assert.ok(s.accounts.A.includes("writing/my-voice"));

    s = k.configure({
      account: "A",
      revision: s.revision,
      id: "writing/my-voice",
      binding: "none",
    });
    assert.equal(s.bindings["writing/my-voice"], undefined);
    assert.equal(
      s.items.find((x) => x.id === "writing/my-voice")?.binding,
      "none",
    );

    s = k.configure({
      account: "A",
      revision: s.revision,
      id: "writing/my-voice",
      binding: ["A"],
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
    assert.equal(s.bindings["writing/my-voice"], undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(mount, { recursive: true, force: true });
  }
});

test("migrate legacy accounts map to bindings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aside-skills-mig-"));
  try {
    const k = new Skills(vaultStub(root));
    writePack(path.join(root, ".agents/skills/alpha"), "alpha", "A skill");
    writePack(path.join(root, ".agents/skills/beta"), "beta", "B skill");
    fs.mkdirSync(path.dirname(k.file), { recursive: true });
    fs.writeFileSync(
      k.file,
      JSON.stringify({
        revision: 1,
        accounts: { AccA: ["alpha"], AccB: ["alpha", "beta"] },
      }),
    );
    const s = k.list("AccA");
    assert.deepEqual(s.bindings.alpha, ["AccA", "AccB"]);
    assert.deepEqual(s.bindings.beta, ["AccB"]);
    assert.ok(s.accounts.AccA.includes("alpha"));
    assert.ok(!s.accounts.AccA.includes("beta"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
