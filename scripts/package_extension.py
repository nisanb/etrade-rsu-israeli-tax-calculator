#!/usr/bin/env python3
import argparse
from pathlib import Path
import zipfile


EXCLUDED_NAMES = {
    ".git",
    ".github",
    "dist",
    "docs",
    "tests",
    "scripts",
    "AGENTS.md",
    "README.md",
    "CONTRIBUTING.md",
    "LICENSE",
    ".DS_Store",
    "stockplan.html",
}


def should_skip(relative_path: Path, file_path: Path, output_path: Path) -> bool:
    parts = set(relative_path.parts)
    if parts & EXCLUDED_NAMES:
        return True
    if any(part.startswith(".") for part in relative_path.parts):
        return True
    if relative_path.name.endswith(":Zone.Identifier"):
        return True
    if file_path.resolve() == output_path.resolve():
        return True
    return False


def package_extension(source_dir: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(source_dir.rglob("*")):
            if not file_path.is_file():
                continue
            relative_path = file_path.relative_to(source_dir)
            if should_skip(relative_path, file_path, output_path):
                continue
            archive.write(file_path, relative_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Package the Chrome extension into a zip file.")
    parser.add_argument("--source", default=".", help="Extension source directory")
    parser.add_argument("--output", required=True, help="Path to the output zip file")
    args = parser.parse_args()

    source_dir = Path(args.source).resolve()
    output_path = Path(args.output).resolve()
    package_extension(source_dir, output_path)
    print(output_path)


if __name__ == "__main__":
    main()
