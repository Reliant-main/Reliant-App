#!/bin/bash
# Installs the Reliant Chit Printer on this Mac and starts it. It starts by itself whenever you log in.
cd "$(dirname "$0")" || exit 1
APP="$HOME/Library/Application Support/ReliantChitPrinter"
PLIST="$HOME/Library/LaunchAgents/com.reliantdistribution.chitprinter.plist"
LABEL="com.reliantdistribution.chitprinter"

echo ""
echo "Installing Reliant Chit Printer (Mac)"
echo ""
if [ ! -x /usr/bin/perl ]; then
  echo "This Mac is missing Perl, which the chit printer needs. Tell Claude what macOS version this is."
  read -r -p "Press Return to close" _; exit 1
fi
if [ ! -f ReliantChitPrinter.pl ]; then
  echo "Can't find ReliantChitPrinter.pl next to this file. Unzip the whole download first, then run this again."
  read -r -p "Press Return to close" _; exit 1
fi

mkdir -p "$APP" "$HOME/Library/LaunchAgents"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
cp ReliantChitPrinter.pl "$APP/ReliantChitPrinter.pl"
chmod 755 "$APP/ReliantChitPrinter.pl"
xattr -d com.apple.quarantine "$APP/ReliantChitPrinter.pl" >/dev/null 2>&1

# Pick the chit printer
PRINTERS=()
while IFS= read -r line; do PRINTERS+=("$line"); done < <(lpstat -a 2>/dev/null | awk '{print $1}')
if [ ${#PRINTERS[@]} -eq 0 ]; then
  echo "No printers are set up on this Mac yet."
  echo "Add the chit printer first: Apple menu > System Settings > Printers & Scanners > Add Printer."
  read -r -p "Press Return to close" _; exit 1
fi
echo "Printers on this Mac:"
PICK=""
for i in "${!PRINTERS[@]}"; do
  echo "  $((i+1)). ${PRINTERS[$i]}"
  if [ -z "$PICK" ] && echo "${PRINTERS[$i]}" | grep -qiE 'tsp|star'; then PICK="${PRINTERS[$i]}"; fi
done
echo ""
if [ -n "$PICK" ]; then
  echo "Chits will print on: $PICK"
  read -r -p "Press Return to keep it, or type the number of a different printer: " ANS
else
  read -r -p "Type the number of the chit printer (the Star TSP700II): " ANS
fi
if [ -n "$ANS" ]; then
  if [[ "$ANS" =~ ^[0-9]+$ ]] && [ "$ANS" -ge 1 ] && [ "$ANS" -le ${#PRINTERS[@]} ]; then PICK="${PRINTERS[$((ANS-1))]}"; else PICK=""; fi
fi
if [ -z "$PICK" ]; then echo "No printer picked. Run the installer again."; read -r -p "Press Return to close" _; exit 1; fi
/usr/bin/perl -MJSON::PP -e 'print JSON::PP->new->encode({printer => $ARGV[0]})' "$PICK" > "$APP/settings.json"

# Start it now and whenever this user logs in
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/usr/bin/perl</string><string>$APP/ReliantChitPrinter.pl</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardErrorPath</key><string>$APP/errors.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null
sleep 2
echo ""
if curl -fsS --max-time 5 http://127.0.0.1:17861/status >/dev/null 2>&1; then
  echo "Done. Reliant Chit Printer is running and will start by itself when you log in."
  echo "Chits will print on: $PICK"
  echo "Next: open the Ticket System in Google Chrome, tick \"This computer prints chits\", then click Reprint last chit."
else
  echo "Installed, but it didn't answer yet. Restart the Mac, then open http://127.0.0.1:17861 in Chrome to check."
fi
echo ""
read -r -p "Press Return to close" _
