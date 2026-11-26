#!/bin/bash
# Stops the Reliant Chit Printer and stops it starting when you log in.
LABEL="com.reliantdistribution.chitprinter"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1
rm -f "$PLIST"
echo "Reliant Chit Printer is stopped and will no longer start when you log in."
read -r -p "Press Return to close" _
