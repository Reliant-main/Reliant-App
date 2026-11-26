#!/usr/bin/perl
# Reliant Chit Printer for Mac (reliant-chit-printer)
# Prints Ticket System chits straight to the chit printer, with no print window.
# The Ticket System (https://reliant-main.github.io/Reliant-App/) sends each chit here on this Mac only.
#
#   Install (and start):  double-click "Install Reliant Chit Printer.command"
#   Remove:               double-click "Remove Reliant Chit Printer.command"
#   Check it is running:  open http://127.0.0.1:17861 in Chrome on this Mac
#   Updates:              it checks the Reliant App for a newer version when it starts and every 6 hours,
#                         and swaps itself in when no chit has printed for 1 hour (never mid-show).
#
# Uses only what comes with macOS: Perl and the built-in printing system (lp / lpstat).
use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;
use JSON::PP;
use MIME::Base64 qw(decode_base64);
use File::Temp qw(tempfile);
use File::Copy qw(copy move);
use POSIX qw(strftime);
use File::Path qw(make_path);

our $VERSION = '1.0.0';
my $PORT        = 17861;
my %ALLOWED     = ('https://reliant-main.github.io' => 1);
my $HOME        = $ENV{HOME} || '/tmp';
my $APP_DIR     = "$HOME/Library/Application Support/ReliantChitPrinter";
my $SCRIPT      = "$APP_DIR/ReliantChitPrinter.pl";
my $SETTINGS    = "$APP_DIR/settings.json";
my $LOG         = "$APP_DIR/chit-printer.log";
my $UPDATE_BASE = $ENV{RELIANT_UPDATE_BASE} || 'https://reliant-main.github.io/Reliant-App';   # override only for testing
my $UPDATE_ID   = 'chit-printer-mac';
my $UPDATE_EVERY = 6 * 3600;
my $QUIET_FOR    = $ENV{RELIANT_UPDATE_BASE} ? 2 : 3600;
my $MAX_BODY     = 4 * 1024 * 1024;
$ENV{PATH} = '/usr/bin:/bin:/usr/sbin:/sbin:' . ($ENV{PATH} || '');

make_path($APP_DIR) unless -d $APP_DIR;
my $JSON = JSON::PP->new->utf8->canonical;

sub log_line {
  my ($m) = @_;
  eval {
    if (-e $LOG && -s $LOG > 1024 * 1024) { rename $LOG, "$LOG.old"; }
    open my $fh, '>>', $LOG or return;
    print $fh strftime('%Y-%m-%d %H:%M:%S', localtime) . "  $m\n";
    close $fh;
  };
}

sub printers {
  my @p;
  for (`lpstat -a 2>/dev/null`) { push @p, $1 if /^(\S+)/; }
  return @p;
}

sub chit_printer {
  if (-e $SETTINGS) {
    my $c = eval { local $/; open my $fh, '<', $SETTINGS or die; my $t = <$fh>; close $fh; $JSON->decode($t) };
    return $c->{printer} if $c && $c->{printer};
  }
  for my $p (printers()) { return $p if $p =~ /tsp|star/i; }
  my $d = `lpstat -d 2>/dev/null`;
  return $1 if $d =~ /:\s*(\S+)/;
  return '';
}

# ------------------------------------------------------------------ printing
sub print_chit {
  my ($png, $w, $h, $printer) = @_;
  die "No chit printer is set up on this Mac\n" unless $printer;
  my %have = map { $_ => 1 } printers();
  die "Printer '$printer' isn't on this Mac\n" unless $have{$printer};
  $w = 2 unless $w && $w > 0 && $w < 20;
  $h = 1 unless $h && $h > 0 && $h < 40;
  my ($fh, $file) = tempfile('reliant-chit-XXXXXX', SUFFIX => '.png', TMPDIR => 1, UNLINK => 0);
  binmode $fh; print $fh $png; close $fh;
  my $media = sprintf('Custom.%sx%sin', fmt($w), fmt($h));
  my @cmd = ('lp', '-d', $printer, '-t', 'Reliant chit',
             '-o', "media=$media", '-o', 'fit-to-page',
             '-o', 'page-left=0', '-o', 'page-right=0', '-o', 'page-top=0', '-o', 'page-bottom=0',
             $file);
  my $out = '';
  my $pid = open(my $ph, '-|');
  die "Couldn't start printing\n" unless defined $pid;
  if (!$pid) { open STDERR, '>&', \*STDOUT; exec @cmd; exit 127; }
  { local $/; $out = <$ph> // ''; }
  close $ph;
  my $rc = $? >> 8;
  unlink $file;
  die "The printer refused the chit: " . ($out =~ s/\s+$//r) . "\n" if $rc != 0;
}
sub fmt { my $n = sprintf('%.2f', $_[0]); $n =~ s/\.?0+$//; return $n; }

# ------------------------------------------------------------------ updates (from the Reliant App's Computer tools list)
my $last_print = 0;
my $next_check = time + ($ENV{RELIANT_UPDATE_BASE} ? 1 : 30);
my $pending;

sub newer {
  my ($a, $b) = @_;
  my @x = split /\./, $a; my @y = split /\./, $b;
  for my $i (0 .. ($#x > $#y ? $#x : $#y)) {
    my $d = ($x[$i] // 0) <=> ($y[$i] // 0);
    return $d > 0 if $d;
  }
  return 0;
}

sub find_update {
  my $t = `curl -fsS --max-time 20 "$UPDATE_BASE/tools.json?t=${\ time}" 2>/dev/null`;
  return undef unless $t;
  my $list = eval { $JSON->decode($t) } or return undef;
  for my $tool (@{ $list->{tools} || [] }) {
    next unless ($tool->{id} // '') eq $UPDATE_ID;
    return $tool->{version} if $tool->{version} && newer($tool->{version}, $VERSION);
  }
  return undef;
}

sub install_update {
  my ($v) = @_;
  return 0 unless $0 eq $SCRIPT;   # only the installed copy updates itself
  my $tmp = "$APP_DIR/update.pl";
  system('curl', '-fsS', '--max-time', '60', '-o', $tmp, "$UPDATE_BASE/chit-printer/mac/ReliantChitPrinter.pl?t=" . time);
  my $ok = ($? == 0 && -s $tmp);
  my $text = '';
  if ($ok) { local $/; open my $fh, '<', $tmp; $text = <$fh> // ''; close $fh; }
  $ok &&= index($text, "our \$VERSION = '$v';") >= 0 && index($text, 'reliant-chit-printer') >= 0;
  $ok &&= system('perl', '-c', $tmp) == 0;
  if (!$ok) { log_line("Update to $v failed: the download didn't check out."); unlink $tmp; return 0; }
  copy($SCRIPT, "$APP_DIR/previous.pl");
  move($tmp, $SCRIPT) or do { log_line("Update to $v failed: couldn't replace the program."); return 0; };
  chmod 0755, $SCRIPT;
  log_line("Updated from $VERSION to $v. Restarting.");
  return 1;
}

sub check_updates {
  my ($server) = @_;
  my $now = time;
  # The check only runs when the printer has been quiet, so it never holds up a chit during a show.
  if ($now >= $next_check && $now - $last_print >= $QUIET_FOR) {
    $next_check = $now + $UPDATE_EVERY;
    my $v = find_update();
    if ($v) { $pending = $v; log_line("Version $v is available; it will go in once no chit has printed for 1 hour."); }
  }
  if ($pending && $now - $last_print >= $QUIET_FOR) {
    my $v = $pending; $pending = undef;
    if (install_update($v)) { close $server; exit 0; }   # macOS starts the new version straight away
  }
}

# ------------------------------------------------------------------ tiny web server (this Mac only)
my %REASON = (200 => 'OK', 204 => 'No Content', 400 => 'Bad Request', 403 => 'Forbidden',
              404 => 'Not Found', 413 => 'Too Large', 500 => 'Error');

sub respond {
  my ($c, $code, $type, $body, $origin) = @_;
  $body //= '';
  utf8::encode($body) if utf8::is_utf8($body);
  my $h = "HTTP/1.1 $code $REASON{$code}\r\nContent-Type: $type\r\nContent-Length: " . length($body)
        . "\r\nCache-Control: no-store\r\nConnection: close\r\n";
  if ($origin) {
    $h .= "Access-Control-Allow-Origin: $origin\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        . "Access-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\n";
  }
  print $c "$h\r\n$body";
}

sub html_escape { my $s = shift // ''; $s =~ s/&/&amp;/g; $s =~ s/</&lt;/g; $s =~ s/>/&gt;/g; $s =~ s/"/&quot;/g; return $s; }

sub read_request {
  my ($c) = @_;
  my $sel = IO::Select->new($c);
  my $data = '';
  while (index($data, "\r\n\r\n") < 0) {
    return undef unless $sel->can_read(5);
    my $n = sysread($c, my $buf, 65536);
    return undef unless $n;
    $data .= $buf;
    return undef if length($data) > 262144;
  }
  my $end = index($data, "\r\n\r\n");
  my @lines = split /\r\n/, substr($data, 0, $end);
  my ($method, $path) = split / /, shift(@lines) // '';
  my %hdr;
  for (@lines) { $hdr{lc $1} = $2 if /^([^:]+):\s*(.*)$/; }
  my $len = $hdr{'content-length'} // 0;
  $len = 0 unless $len =~ /^\d+$/;
  my $body = substr($data, $end + 4);
  while (length($body) < $len && $len <= $MAX_BODY) {
    last unless $sel->can_read(5);
    my $n = sysread($c, my $buf, 65536);
    last unless $n;
    $body .= $buf;
  }
  return { method => $method // '', path => $path // '/', headers => \%hdr, length => $len, body => $body };
}

sub handle {
  my ($c, $r) = @_;
  my $origin = $r->{headers}{origin};
  my $ok_origin = $origin && $ALLOWED{$origin};
  my $reply_to = $ok_origin ? $origin : undef;
  my ($path) = split /\?/, $r->{path};
  $path //= '/';

  if ($r->{method} eq 'OPTIONS') {
    return $ok_origin ? respond($c, 204, 'text/plain', '', $origin) : respond($c, 403, 'text/plain', 'Not allowed');
  }
  if ($r->{method} eq 'GET' && $path eq '/') {
    my $p = html_escape(chit_printer());
    return respond($c, 200, 'text/html; charset=utf-8',
      "<!doctype html><meta charset=utf-8><title>Reliant Chit Printer</title><body style='font:16px -apple-system,Helvetica,Arial;padding:24px'>"
      . "<h2>Reliant Chit Printer is running</h2><p>Mac version $VERSION. Chits print on <b>$p</b>.</p></body>", $reply_to);
  }
  return respond($c, 403, 'text/plain', 'Not allowed') if $origin && !$ok_origin;
  if ($r->{method} eq 'GET' && $path eq '/status') {
    return respond($c, 200, 'application/json',
      $JSON->encode({ ok => JSON::PP::true, app => 'reliant-chit-printer', platform => 'mac', version => $VERSION,
                      printer => chit_printer(), updating => $pending }), $reply_to);
  }
  if ($r->{method} eq 'POST' && $path eq '/print') {
    return respond($c, 403, 'text/plain', 'Not allowed') unless $ok_origin;
    return respond($c, 413, 'application/json', '{"ok":false,"error":"Chit too large"}', $reply_to) if $r->{length} > $MAX_BODY;
    my $printer = chit_printer();
    my $res = eval {
      my $j = $JSON->decode($r->{body});
      my $png = decode_base64($j->{png} // '');
      die "The chit picture was empty\n" unless length $png;
      $last_print = time;
      print_chit($png, $j->{width}, $j->{height}, $printer);
      $last_print = time;
      1;
    };
    if ($res) { return respond($c, 200, 'application/json', $JSON->encode({ ok => JSON::PP::true, printer => $printer }), $reply_to); }
    my $msg = ($@ || 'Unknown error') =~ s/\s+$//r;
    log_line("Print failed: $msg");
    return respond($c, 500, 'application/json', $JSON->encode({ ok => JSON::PP::false, error => $msg }), $reply_to);
  }
  respond($c, 404, 'text/plain', 'Not found', $reply_to);
}

$SIG{PIPE} = 'IGNORE';
my $server = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $PORT, Proto => 'tcp', Listen => 16, ReuseAddr => 1);
if (!$server) { log_line("Port $PORT is busy (another copy is probably running). Exiting."); sleep 30; exit 0; }
log_line("Started Mac version $VERSION. Chit printer: " . chit_printer());

my $sel = IO::Select->new($server);
while (1) {
  if (!$sel->can_read(1)) { eval { check_updates($server) }; log_line("Update error: $@") if $@; next; }
  my $c = $server->accept or next;
  $c->autoflush(1);
  eval { my $r = read_request($c); handle($c, $r) if $r; };
  log_line("Request error: $@") if $@;
  close $c;
}
