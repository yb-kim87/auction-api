import sys

from server import run_server


def main():
    if len(sys.argv) < 2 or sys.argv[1] != "serve":
        print("Usage: python runner.py serve", file=sys.stderr)
        sys.exit(1)
    run_server()


if __name__ == "__main__":
    main()
