const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  parseXAnalyticsCsv,
  xRowToYaml,
  parseXDate,
  splitCsvLine,
} = require("../x-import.cjs");

test("splitCsvLine handles quotes and escaped quotes", () => {
  assert.deepEqual(splitCsvLine('a,"b,c","d""e"'), ["a", "b,c", 'd"e']);
});

test("parseXDate accepts ISO and US formats", () => {
  assert.equal(parseXDate("2026-08-15 13:12:39 +0000"), "2026-08-15");
  assert.equal(parseXDate("8/15/2026 13:12"), "2026-08-15");
});

test("parse X Analytics CSV and map to YAML", () => {
  const csv = [
    "Tweet id,Tweet permalink,Tweet text,time,impressions,engagements,engagement rate,retweets,replies,likes",
    '1,https://x.com/a/1,"Hello, world",2026-08-15 12:00:00 +0000,1000,50,0.05,3,2,40',
    "2,https://x.com/a/2,Second post,2026-08-16 12:00:00 +0000,200,10,0.05,1,0,8",
  ].join("\n");
  const rows = parseXAnalyticsCsv(Buffer.from(csv, "utf8"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Hello, world");
  assert.equal(rows[0].impressions, 1000);
  assert.equal(rows[0].engagements, 50);
  assert.equal(rows[0].likes, 40);
  assert.equal(rows[0].replies, 2);
  assert.equal(rows[0].retweets, 3);
  const yaml = xRowToYaml(rows[0]);
  assert.equal(yaml["发布时间"], "2026-08-15");
  assert.equal(yaml["曝光"], 1000);
  assert.equal(yaml["互动"], 50);
  assert.equal(yaml["点赞"], 40);
  assert.equal(yaml["回复"], 2);
  assert.equal(yaml["转发"], 3);
});

test("parseXAnalyticsCsv rejects missing Tweet text column", () => {
  assert.throws(
    () => parseXAnalyticsCsv(Buffer.from("impressions,likes\n1,2\n", "utf8")),
    /Tweet text/,
  );
});
