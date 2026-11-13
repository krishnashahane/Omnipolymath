process.env.OMNIPOLYMATH_VITEST_IMPORT_DURATIONS = "1";
process.env.OMNIPOLYMATH_VITEST_PRINT_IMPORT_BREAKDOWN = "1";

await import("./test-projects.mts");
