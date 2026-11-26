"""Check JoinTally against SQLite using Python 3.9+ and Node on PATH."""

import json
import random
import sqlite3
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODES = [(join, nulls) for join in ("left", "inner") for nulls in ("distinct", "match")]

# The JS adapter calls the same exported function as the browser and CLI.
NODE = """
import fs from 'node:fs';
import { analyze } from './src/analyze.mjs';
const { fixtures, modes } = JSON.parse(fs.readFileSync(0, 'utf8'));
const keys = [{ left: 'account', right: 'customer' }, { left: 'region', right: 'market' }];
const results = fixtures.flatMap(([left, right]) => modes.map(([join, nulls]) => {
  const r = analyze(left, right, { keys, measure: 'amount', join, nulls, limit: 0 });
  return { before: r.before, after: r.after, outputRows: r.outputRows };
}));
process.stdout.write(JSON.stringify(results));
"""


def money(cents):
    sign = "-" if cents < 0 else ""
    whole, remainder = divmod(abs(cents), 100)
    return f"{sign}{whole}.{remainder:02d}"


def fixtures():
    yield [], []
    yield [("", "eu", 125)], []
    yield [], [("", "eu")]
    yield [
        ("a", "eu", 999), ("a", "eu", -999), ("a", "", 750), ("", "eu", -107),
        ("", "", 10), ("01", "us", 0), ("1", "us", 405), ("z", "ap", -50),
    ], [
        ("a", "eu"), ("a", "eu"), ("a", ""), ("", "eu"), ("", "eu"),
        ("", ""), ("", ""), ("01", "us"), ("unmatched", "ap"),
    ]
    rng = random.Random(14363)
    accounts = ["", "1", "01", "a", "A", " ", "a,b", "é"]
    regions = ["", "eu", "us", "b,eu", " "]
    for _ in range(64):
        pool = [(rng.choice(accounts), rng.choice(regions)) for _ in range(rng.randint(1, 12))]
        left = [(*rng.choice(pool), rng.randint(-12500, 12500)) for _ in range(rng.randrange(30))]
        right = [rng.choice(pool) for _ in range(rng.randrange(30))]
        yield left, right


def run():
    tables, expected = [], []
    db = sqlite3.connect(":memory:")
    db.executescript("""
        CREATE TABLE ledger(account TEXT, region TEXT, cents INTEGER);
        CREATE TABLE directory(market TEXT, customer TEXT);
    """)
    for left, right in fixtures():
        tables.append((
            [["account", "region", "amount"]] + [[a, r, money(c)] for a, r, c in left],
            [["market", "customer"]] + [[r, a] for a, r in right],
        ))
        db.execute("DELETE FROM ledger")
        db.execute("DELETE FROM directory")
        # Represent a CSV empty field as SQL NULL. SQLite's IS comparison
        # matches two NULLs, while ordinary equality leaves them unmatched.
        db.executemany("INSERT INTO ledger VALUES (?, ?, ?)", [(a or None, r or None, c) for a, r, c in left])
        db.executemany("INSERT INTO directory VALUES (?, ?)", [(r or None, a or None) for a, r in right])
        before, = db.execute("SELECT coalesce(sum(cents), 0) FROM ledger").fetchone()
        for join, nulls in MODES:
            operator = "=" if nulls == "distinct" else "IS"
            query = f"""
                SELECT count(*), coalesce(sum(l.cents), 0)
                FROM ledger AS l {join} JOIN directory AS d
                  ON l.account {operator} d.customer AND l.region {operator} d.market
            """
            rows, after = db.execute(query).fetchone()
            expected.append({
                "before": money(before) if left else "0",
                "after": money(after) if left else "0",
                "outputRows": rows,
            })
    db.close()
    output = subprocess.check_output(
        ["node", "--input-type=module", "-e", NODE], cwd=ROOT,
        input=json.dumps({"fixtures": tables, "modes": MODES}), text=True,
    )
    actual = json.loads(output)
    if len(actual) != len(expected):
        raise SystemExit(f"Expected {len(expected)} results, received {len(actual)}.")
    for index, (want, got) in enumerate(zip(expected, actual)):
        if want != got:
            case, mode = divmod(index, len(MODES))
            raise SystemExit(f"Fixture {case}, {MODES[mode]}: SQLite {want}, JoinTally {got}\n{tables[case]}")
    print(f"SQLite agreement on {len(actual)} joins across {len(tables)} fixtures.")


if __name__ == "__main__":
    run()
