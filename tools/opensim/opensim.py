#!/usr/bin/env python3
"""
Run a real OpenSimulator 0.9.3 locally for integration tests (no Docker needed).

    python3 tools/opensim/opensim.py start     # download (cached), configure, boot, create test accounts, then leave it running
    python3 tools/opensim/opensim.py login     # smoke test: XML-RPC login as the test avatar, print what the grid answers
    python3 tools/opensim/opensim.py console show users   # send any OpenSim console command
    python3 tools/opensim/opensim.py stop

Adapted from Kaleaon/React-Linkpoint (android-kotlin/tools/opensim/live.py), which runs the same setup in CI. Differences: one
region, no Gradle/OAR dependency, start/stop as separate commands so other tests can use the grid while it runs.

Needs: python3, curl, unzip, .NET 8 runtime (`dotnet`) and libgdiplus. Debian/Ubuntu: apt-get install -y dotnet-sdk-8.0 libgdiplus
Environment: OPENSIM_WORK (default /tmp/charmorph-opensim), OPENSIM_DIST_URL (override the download).
"""
import hashlib, json, os, re, shutil, signal, subprocess, sys, time, xmlrpc.client, zipfile

CACHE = os.path.expanduser("~/.cache/charmorph-opensim")
WORK = os.environ.get("OPENSIM_WORK", "/tmp/charmorph-opensim")
VERSION = "0.9.3.0"
DIST = os.environ.get("OPENSIM_DIST_URL", "https://github.com/opensim/opensim/releases/download/r04ca1d9/LastDotNetBuild.zip")
LOGIN_PORT, UDP_PORT, REGION = 9002, 9100, "Test Isle"
USER = ("Char", "Tester", "testpass1", "char@example.com")
PIDFILE = os.path.join(WORK, "opensim.pid")
INFO = os.path.join(WORK, "grid.json")

def log(*a): print("[opensim]", *a, flush=True)

def need(cmd, hint):
    if not shutil.which(cmd): sys.exit(f"missing '{cmd}': {hint}")

def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0: return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    log("downloading", url); tmp = dest + ".part"
    # curl honours the proxy settings of sandboxes and CI; urllib can ignore them and hang.
    if subprocess.call(["curl", "-fsSL", "--retry", "3", "-m", "1800", "-o", tmp, url]) != 0: sys.exit(f"download failed: {url}")
    os.rename(tmp, dest); return dest

class Grid:
    def __init__(self):
        self.bin = os.path.join(WORK, "opensim", "bin")
        self.logfile = os.path.join(WORK, "opensim.log")
        self.proc = None; self.pos = 0

    def configure(self):
        with zipfile.ZipFile(download(DIST, os.path.join(CACHE, f"opensim-{VERSION}.zip"))) as z: z.extractall(WORK)
        if not os.path.exists(self.bin) and os.path.exists(os.path.join(WORK, "bin")): self.bin = os.path.join(WORK, "bin")
        b = self.bin
        shutil.copy(f"{b}/OpenSim.ini.example", f"{b}/OpenSim.ini")
        shutil.copy(f"{b}/config-include/StandaloneCommon.ini.example", f"{b}/config-include/StandaloneCommon.ini")
        ini = open(f"{b}/OpenSim.ini").read()
        ini = re.sub(r'^;\s*Include-Architecture = "config-include/Standalone.ini"', '    Include-Architecture = "config-include/Standalone.ini"', ini, flags=re.M)
        ini = ini.replace('PublicPort = "9000"', f'PublicPort = "{LOGIN_PORT}"')
        ini = re.sub(r'^\s*;*\s*http_listener_port = 9000', f'    http_listener_port = {LOGIN_PORT}', ini, flags=re.M)
        open(f"{b}/OpenSim.ini", "w").write(ini)
        common = open(f"{b}/config-include/StandaloneCommon.ini").read()
        # A default region gives new accounts a home (otherwise "Unable to set home for account").
        common = re.sub(r'^\s*Region_Welcome_Area = .*$', f'    Region_{REGION.replace(" ", "_")} = "DefaultRegion, DefaultHGRegion, FallbackRegion"', common, count=1, flags=re.M)
        open(f"{b}/config-include/StandaloneCommon.ini", "w").write(common)
        os.makedirs(f"{b}/Regions", exist_ok=True)
        open(f"{b}/Regions/Regions.ini", "w").write(
            f"[{REGION}]\nRegionUUID = 11111111-2222-3333-4444-aaaaaaaaaaaa\nLocation = 1000,1000\nSizeX = 256\nSizeY = 256\n"
            f"InternalAddress = 0.0.0.0\nInternalPort = {UDP_PORT}\nAllowAlternatePorts = False\nExternalHostName = 127.0.0.1\n")

    def text(self): return open(self.logfile, errors="replace").read()
    def send(self, line): self.proc.stdin.write(line + "\n"); self.proc.stdin.flush()

    # Answers to the console's interactive prompts, matched against the end of the log.
    PROMPTS = [(r"existing estate \(yes/no\)\? \[.*\]: $", "yes"), (r"[Nn]ame of estate to join.*: $", "Test Estate"),
               (r"New estate name \[.*\]: $", "Test Estate"), (r"Estate owner first name \[.*\]: $", "Test"),
               (r"Estate owner last name \[.*\]: $", "Owner"), (r"Password: $", "ownerpass"), (r"Email: $", "owner@example.com"),
               (r"User ID \(.*\) ?\[.*\]: $", ""), (r"User ID \[.*\]: $", ""), (r"Model name \[.*\]: $", ""), (r"Estate name to join \[.*\]: $", "Test Estate")]

    def wait(self, pattern, timeout=300, what=None):
        end = time.time() + timeout; rx = re.compile(pattern)
        while time.time() < end:
            if self.proc.poll() is not None: sys.exit(f"OpenSim exited early (code {self.proc.returncode}); see {self.logfile}\n" + self.text()[-1500:])
            t = self.text()[self.pos:]
            m = rx.search(t)
            if m: self.pos += m.end(); return
            for p, ans in self.PROMPTS:
                if re.search(p, t[-200:]):
                    self.pos += len(t); self.send(ans); time.sleep(0.3); break
            time.sleep(0.3)
        sys.exit(f"timed out waiting for {what or pattern}; see {self.logfile}\n" + self.text()[-1500:])

    def boot(self):
        # stdin stays attached to a pipe we keep open from a detached helper, so the console survives this script exiting.
        self.proc = subprocess.Popen(["dotnet", "OpenSim.dll", "-console=basic"], cwd=self.bin, stdin=subprocess.PIPE,
                                     stdout=open(self.logfile, "w"), stderr=subprocess.STDOUT, text=True, bufsize=1, start_new_session=True)
        self.wait(r"Region \((?:%s|root)\) # " % re.escape(REGION), 300, "OpenSim console")
        log("OpenSim is up")
        first, last, pw, mail = USER
        self.send(f"create user {first} {last} {pw} {mail}"); self.wait(r"created successfully", 60, "account creation")
        log(f"account created: {first} {last}")

def md5pw(pw): return "$1$" + hashlib.md5(pw.encode()).hexdigest()

def login():
    """XML-RPC login_to_simulator, the way every viewer starts. Returns the grid's answer as a dict."""
    first, last, pw, _ = USER
    srv = xmlrpc.client.ServerProxy(f"http://127.0.0.1:{LOGIN_PORT}/")
    return srv.login_to_simulator({"first": first, "last": last, "passwd": md5pw(pw), "start": "last", "channel": "charmorph-test",
                                   "version": "0.1", "platform": "Lin", "mac": "00:00:00:00:00:00", "id0": "00000000000000000000000000000000",
                                   "agree_to_tos": "true", "read_critical": "true", "viewer_digest": "", "options": ["inventory-root", "inventory-skeleton"]})

def cmd_start():
    need("dotnet", ".NET 8 runtime, e.g. apt-get install -y dotnet-sdk-8.0"); need("curl", "curl")
    if subprocess.run("PATH=$PATH:/usr/sbin ldconfig -p | grep -q gdiplus", shell=True).returncode != 0:
        sys.exit("missing libgdiplus (apt-get install -y libgdiplus); OpenSim cannot start without it")
    if os.path.exists(PIDFILE):
        try: os.kill(int(open(PIDFILE).read()), 0); sys.exit(f"already running (pid file {PIDFILE}); run 'stop' first")
        except (OSError, ValueError): pass
    shutil.rmtree(WORK, ignore_errors=True); os.makedirs(WORK)
    g = Grid(); g.configure(); g.boot()
    open(PIDFILE, "w").write(str(g.proc.pid))
    json.dump({"loginUri": f"http://127.0.0.1:{LOGIN_PORT}/", "user": " ".join(USER[:2]), "password": USER[2], "region": REGION, "log": g.logfile}, open(INFO, "w"))
    log(f"running (pid {g.proc.pid}); login http://127.0.0.1:{LOGIN_PORT}/ as '{USER[0]} {USER[1]}' / '{USER[2]}'; log {g.logfile}")
    # Keep feeding the console's stdin from a tiny detached process so OpenSim does not see EOF and quit.
    subprocess.Popen(["sleep", "infinity"], stdout=g.proc.stdin, start_new_session=True)

def cmd_login():
    r = login()
    keys = ("login", "reason", "message", "first_name", "last_name", "agent_id", "sim_ip", "sim_port", "seed_capability", "region_x", "region_y", "inventory-root")
    summary = {k: (r[k] if k in r and k != "seed_capability" else (str(r[k])[:60] + "…" if k in r else None)) for k in keys}
    summary["inventory_folders"] = len(r.get("inventory-skeleton", []))
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if r.get("login") == "true" else 1)

def console(line, wait=2.0):
    """Send one command to the running grid's console and return what it printed meanwhile."""
    pid = int(open(PIDFILE).read()); logfile = os.path.join(WORK, "opensim.log")
    before = os.path.getsize(logfile)
    with open(f"/proc/{pid}/fd/0", "w") as f: f.write(line + "\n")  # the console reads this pipe
    time.sleep(wait)
    with open(logfile, errors="replace") as f: f.seek(before); return f.read()

def cmd_console():
    print(console(" ".join(sys.argv[2:]) or "help"))

def cmd_stop():
    if not os.path.exists(PIDFILE): sys.exit("not running")
    pid = int(open(PIDFILE).read())
    try: os.kill(pid, signal.SIGTERM)
    except OSError: pass
    for _ in range(60):
        try: os.kill(pid, 0); time.sleep(0.5)
        except OSError: break
    for f in (PIDFILE, INFO):
        if os.path.exists(f): os.remove(f)
    log("stopped")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"start": cmd_start, "login": cmd_login, "console": cmd_console, "stop": cmd_stop}.get(cmd, lambda: sys.exit(__doc__))()
