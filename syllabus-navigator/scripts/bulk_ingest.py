import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Bulk ingest syllabus files.")
    parser.add_argument("--path", required=True, help="Directory with syllabus files")
    args = parser.parse_args()

    base_path = Path(args.path)
    if not base_path.exists():
        raise FileNotFoundError(f"Path not found: {base_path}")

    files = [p for p in base_path.iterdir() if p.is_file()]
    print(f"Found {len(files)} files to ingest")
    for file in files:
        print(f"[TODO] ingest -> {file.name}")


if __name__ == "__main__":
    main()
