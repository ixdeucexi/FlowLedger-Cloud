import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const backup = require("../plugins/withPrivateAndroidBackup");

test("Android manifest and generated backup XML exclude financial caches and SecureStore from cloud and device transfer", async () => {
  const manifest = { manifest: { application: [{  $: { "android:name": ".MainApplication", "android:allowBackup": "true", "android:fullBackupContent": "@xml/secure_store_backup_rules" } }] } };
  backup.applyManifest(manifest);
  const attrs = manifest.manifest.application[0].$ as Record<string, string>;
  assert.equal(attrs["android:allowBackup"], "false");
  assert.equal(attrs["android:fullBackupContent"], "@xml/flowledger_backup_rules");
  assert.equal(attrs["android:dataExtractionRules"], "@xml/flowledger_data_extraction_rules");
  const root = await mkdtemp(join(tmpdir(), "flowledger-backup-"));
  try {
    await backup.writeRules(root);
    const old = await readFile(join(root, "app/src/main/res/xml/flowledger_backup_rules.xml"), "utf8");
    const modern = await readFile(join(root, "app/src/main/res/xml/flowledger_data_extraction_rules.xml"), "utf8");
    for (const domain of backup.DOMAINS) {
      assert.ok(old.includes(`<exclude domain="${domain}" path="." />`));
      assert.equal(modern.split(`<exclude domain="${domain}" path="." />`).length - 1, 2);
    }
    assert.match(modern, /<cloud-backup>/); assert.match(modern, /<device-transfer>/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
