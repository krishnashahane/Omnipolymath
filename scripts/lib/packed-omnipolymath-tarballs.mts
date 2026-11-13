import fs from "node:fs/promises";
import path from "node:path";

export function validatePackedTarballOutputName(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.t(?:ar\.)?gz$/u.test(value)) {
    throw new Error(`--output-name must be a tarball filename, not a path: ${value}`);
  }
}

export async function cleanPackedOmnipolymathTarballs(outputDir: string) {
  let entries: string[];
  try {
    entries = await fs.readdir(outputDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      entries = [];
    } else {
      throw error;
    }
  }
  await Promise.all(
    entries
      .filter((entry) => /^omnipolymath-[A-Za-z0-9._-]+\.tgz$/u.test(entry))
      .map((entry) => fs.rm(path.join(outputDir, entry), { force: true })),
  );
}

function resolvePackedOmnipolymathFileName(value: string) {
  const filename = value.trim();
  if (
    !filename.endsWith(".tgz") ||
    (!filename.startsWith("omnipolymath-") && !/[\\/:]/u.test(filename))
  ) {
    return "";
  }
  if (!/^omnipolymath-[A-Za-z0-9._-]+\.tgz$/u.test(filename)) {
    throw new Error(`npm pack reported unsafe Omnipolymath tarball filename: ${filename}`);
  }
  return filename;
}

export async function newestOmnipolymathTarball(outputDir: string, packOutput: string) {
  let fromOutput = "";
  for (const line of packOutput.split(/\r?\n/u)) {
    const filename = resolvePackedOmnipolymathFileName(line);
    if (filename) {
      fromOutput = filename;
    }
  }
  if (fromOutput) {
    return path.join(outputDir, fromOutput);
  }

  const entries = await fs.readdir(outputDir);
  const packed = entries
    .filter((entry) => {
      try {
        return resolvePackedOmnipolymathFileName(entry) === entry;
      } catch {
        return false;
      }
    })
    .toSorted()
    .at(-1);
  if (!packed) {
    throw new Error(`missing packed Omnipolymath tarball in ${outputDir}`);
  }
  return path.join(outputDir, packed);
}
