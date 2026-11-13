import fs from "node:fs";

const configPath = process.env.OMNIPOLYMATH_CONFIG_PATH;
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.ui.seamColor = "#ff6600";
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
