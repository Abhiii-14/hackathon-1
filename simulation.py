state = "NORMAL"

print("SafeGuard ESP32 - Logic Simulation")
print("Initial state:", state)

while True:
    command = input("Enter e=emergency, r=reset, q=quit: ").lower().strip()

    if command == "e":
        if state != "EMERGENCY":
            state = "EMERGENCY"
            print("ALERT! Emergency activated")
        else:
            print("Emergency remains active")

    elif command == "r":
        state = "NORMAL"
        print("System reset to NORMAL")

    elif command == "q":
        print("Simulation stopped")
        break

    else:
        print("Invalid command")

    print("Current state:", state)
