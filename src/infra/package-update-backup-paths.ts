export function isLegacyPackageBackupName(name: string): boolean {
  return /^\.omnipolymath[.-]package-backup-\d+-\d+$/u.test(name);
}

export function isPackageUpdateRecoveryArtifactName(name: string): boolean {
  return /^\.omnipolymath[.-]package-(?:backup-|activation-)/u.test(name);
}
