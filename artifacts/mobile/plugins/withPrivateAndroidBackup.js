const fs = require("node:fs/promises");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

// Both credential-protected and device-protected storage domains are excluded.
// This includes SecureStore and AsyncStorage financial snapshots, not just tokens.
const DOMAINS = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];
const excludes = DOMAINS.map(domain => `    <exclude domain="${domain}" path="." />`).join("\n");
const backupXml = `<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n${excludes}\n</full-backup-content>\n`;
const extractionXml = `<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n${excludes}\n  </cloud-backup>\n  <device-transfer>\n${excludes}\n  </device-transfer>\n</data-extraction-rules>\n`;
function applyManifest(manifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  application.$["android:allowBackup"] = "false";
  application.$["android:fullBackupContent"] = "@xml/flowledger_backup_rules";
  application.$["android:dataExtractionRules"] = "@xml/flowledger_data_extraction_rules";
  return manifest;
}
async function writeRules(platformRoot) {
  const directory = path.join(platformRoot, "app", "src", "main", "res", "xml");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "flowledger_backup_rules.xml"), backupXml);
  await fs.writeFile(path.join(directory, "flowledger_data_extraction_rules.xml"), extractionXml);
}
function withPrivateAndroidBackup(config) {
  config = withAndroidManifest(config, mod => { mod.modResults = applyManifest(mod.modResults); return mod; });
  return withDangerousMod(config, ["android", async mod => { await writeRules(mod.modRequest.platformProjectRoot); return mod; }]);
}
module.exports = withPrivateAndroidBackup;
module.exports.applyManifest = applyManifest;
module.exports.writeRules = writeRules;
module.exports.DOMAINS = DOMAINS;
