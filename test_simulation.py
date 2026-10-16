import subprocess
import sys

tests = [
    {
        "name": "Emergency activation",
        "inputs": "e\nq\n",
        "expected": "ALERT! Emergency activated"
    },
    {
        "name": "Emergency remains active",
        "inputs": "e\ne\nq\n",
        "expected": "Emergency remains active"
    },
    {
        "name": "Reset to normal",
        "inputs": "e\nr\nq\n",
        "expected": "System reset to NORMAL"
    }
]

all_passed = True

for test in tests:
    result = subprocess.run(
        [sys.executable, "simulation.py"],
        input=test["inputs"],
        capture_output=True,
        text=True
    )

    passed = (
        result.returncode == 0
        and test["expected"] in result.stdout
    )

    print(
        f'{"PASS" if passed else "FAIL"}: {test["name"]}'
    )

    if not passed:
        all_passed = False
        print(result.stdout)
        print(result.stderr)

if all_passed:
    print("All simulation tests passed!")
else:
    sys.exit(1)