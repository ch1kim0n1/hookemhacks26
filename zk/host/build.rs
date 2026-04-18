fn main() {
    // Compile every guest program referenced in Cargo.toml's
    // [package.metadata.risc0] methods list and emit
    // <NAME>_ELF / <NAME>_ID constants at build time.
    risc0_build::embed_methods();
}
