+++
title = 'The request is a trust boundary'
description = 'Every byte of an HTTP request was written by the client. Security decisions must come from state the server owns, never from what the request says about itself.'
question = 'Which parts of a request can my code believe?'
weight = 1
difficulty = 1
prerequisites = []
date = 2026-05-15
lastmod = 2026-05-15
verified = 2026-05-15
+++

## The idea in one minute

An HTTP request is a message composed by the client. The method, the path, the
query string, every header, every cookie, the body, the `Host`, the
`X-Forwarded-For` chain, the object ID in the URL: **all of it is
attacker-controlled**, because the attacker can be the client. A browser is a
convenience, not a guarantee. Anyone can send any bytes with `curl`, a script,
or an intercepting proxy.

So a request can only make **claims**. "I am Alice." "I am an admin." "I came
from the office network." "This is order 1002." "My host is app.example.com."
Your code turns a claim into a fact only by checking it against something the
client cannot write: a session record in your database, a signature made with a
key the client does not hold, the TCP peer address of a connection you
accepted, or a configuration value.

The consequence to act on: for every security decision in a handler, name the
value it rests on and ask **who could have written that value**. If the answer
includes "the client", the decision is not yet a decision.

## A picture

```mermaid {title="Claims cross the boundary; facts come from server-owned state"}
flowchart LR
  subgraph REQ["Request: written by the client"]
    direction TB
    H["<b>Headers</b><br/><small>X-User-Id, X-Role, Host, XFF</small>"]
    C["<b>Cookies</b><br/><small>session=s-7f3a9c</small>"]
    P["<b>Path and body</b><br/><small>/invoices/1002, price=0</small>"]
  end
  B["<b>Boundary</b><br/><small>verify, look up, ignore</small>"]
  subgraph SRV["Server-owned state"]
    direction TB
    S["<b>Session store</b><br/><small>token to user</small>"]
    D["<b>Database</b><br/><small>roles, owners, prices</small>"]
    K["<b>Config and keys</b><br/><small>base URL, trusted proxies</small>"]
  end
  E["<b>Decision</b><br/><small>allow, deny, 404</small>"]
  H --> B
  C --> B
  P --> B
  S --> B
  D --> B
  K --> B
  B --> E
  class H,C,P warn
  class B good
  class S,D,K memory
  class E compute
```

The request supplies **keys** (a session token, an object ID). The server
supplies **values** (who that token belongs to, who owns that object). A
decision built only from the left-hand side is a decision the client made.

## How it really works

### Every field, and who wrote it

| Field | What it looks like it says | What it actually is |
| --- | --- | --- |
| Path and query | "the resource I want" | Any string. Object IDs can be guessed, enumerated, or copied from another user. |
| Body (JSON, form) | "the fields this form has" | Any fields, including ones the form never showed: `role`, `price`, `owner_id`. |
| `Cookie` | "my session" | Whatever the client stores. Cookies have no integrity of their own; RFC 6265 warns that a sibling subdomain can set cookies for the parent domain. |
| `Authorization` | "my token" | A string. Worth exactly what verifying its signature, issuer, audience, and expiry is worth. |
| `Host` | "the site you are" | Chosen by the client. RFC 9110 requires it, nothing makes it honest. |
| `X-Forwarded-For` | "the real client IP" | A list anyone can prepend to. Only the entries added by proxies you operate mean anything. |
| `X-User-Id`, `X-Role`, any custom header | "set by the gateway" | Set by whoever sent the request, unless something in front strips and rewrites it. |
| `Origin`, `Referer` | "the page that sent this" | Reliable as a browser signal (scripts in a browser cannot forge `Origin`), worthless against a non-browser client. |
| `User-Agent` | "the app" | Free text. |

One value is different: the **peer address** of the TCP connection your server
accepted. The client cannot pick it freely and still receive your response. If
your server sits behind a load balancer, though, that peer is the load
balancer, which is why the real client address travels in a header, and why
that header needs care.

Whatever tool composed the request, the server receives the same kind of bytes.
Look at which arrow the client does not control.

```mermaid {title="A browser, a script, and a proxy all write the same request; only the TCP peer is not theirs"}
flowchart LR
  BR("Browser")
  CU("curl or a script")
  PX("Intercepting proxy")
  R["<b>Request bytes</b><br/><small>method, path, headers, cookies, body</small>"]
  T["<b>TCP peer address</b><br/><small>fixed by the accepted connection</small>"]
  S("Your server")
  BR --> R
  CU --> R
  PX --> R
  R -->|"client-written"| S
  T -->|"not freely chosen"| S
  class R warn
  class T good
```

### Trust established versus trust assumed

**Trust is established** when the code checks a claim against something the
client cannot produce:

- A session cookie is an opaque random token. The server looks it up in its own
  store and gets back a user ID. The token is a key; the identity is the value
  the server holds. Guessing a valid token must be infeasible, so it comes from
  a cryptographic random source such as Python's `secrets.token_urlsafe(32)`.
- A signed token (a JWT, a webhook signature) is verified with a key the client
  does not hold, and its issuer, audience, and expiry are checked. Only then are
  its claims facts.
- A mutual TLS connection proves the peer holds a private key for a certificate
  your CA issued.
- A role, a price, or an owner comes from **your database**, looked up by an ID
  that the request supplied and that you have checked the caller may use.

Follow one request through the established path: the cookie and the invoice ID
are only used as lookup keys.

```mermaid {title="The request names the keys; the session store and database supply the values"}
sequenceDiagram
  autonumber
  participant B as Browser
  participant H as Handler
  participant S as Session store
  participant D as Database
  B->>H: GET /invoices/1002 with cookie session=s-b81e04
  H->>S: who owns token s-b81e04?
  S-->>H: mallory
  H->>D: who owns invoice 1002?
  D-->>H: bob
  alt owner equals session user
    H-->>B: 200 invoice
  else owner differs
    H-->>B: 404, same as does not exist
  end
  Note over B,H: nothing the browser wrote decided the answer
```

**Trust is assumed** when code reads a claim and acts on it: `user =
request.headers["X-User-Id"]`, `if form["is_admin"]`, `price = body["price"]`,
`ip = xff.split(",")[0]`, `link = "https://" + request.host + "/reset"`. Each of
these reads a value and skips the question of who wrote it.

The most dangerous assumptions hide in architecture rather than in one line.
"The gateway sets `X-User-Id`, so the service trusts it" is sound **only if**
the gateway removes any `X-User-Id` the client sent, and the service accepts
connections **only** from the gateway. If a second path reaches the service (a
debug port, a misconfigured ingress, another internal service an attacker can
reach through server-side request forgery), the header is attacker-controlled
again. Prefer a credential the service can verify itself, such as a short-lived
token signed by the gateway or a mutual TLS identity, over a bare header that
is trusted because of where it is expected to come from.

The solid path is the one the design assumes. Each dashed path reaches the same
service without passing the gateway, carrying whatever header the attacker
chose.

```mermaid {title="A gateway-set header is only as trustworthy as the claim that no other path exists"}
flowchart LR
  AT(["Attacker"])
  GW("Gateway strips, then sets X-User-Id")
  SV("Service reads X-User-Id")
  DBG["<b>Debug port</b>"]
  ING["<b>Misconfigured ingress</b>"]
  INT["<b>Internal service</b><br/><small>reached through SSRF</small>"]
  AT -->|"X-User-Id: root"| GW
  GW -->|"X-User-Id from a verified token"| SV
  AT -.->|"X-User-Id: root"| DBG
  AT -.-> ING
  AT -.-> INT
  DBG -.-> SV
  ING -.-> SV
  INT -.-> SV
  class DBG,ING,INT warn
```

### Server-side enforcement

A client-side check is user experience. It saves a round trip and gives a
friendly error. It does not stop anyone, because the attacker is not running
your JavaScript. Every rule that matters runs on the server:

- **Validation.** A field limited to 100 characters in the form must be limited
  to 100 characters in the handler.
- **Authorization.** Hiding the "Delete user" button from non-admins does not
  remove the `DELETE /users/{id}` route. The handler must check the caller's
  role from server-side state.
- **Business rules.** The total, the discount, and the shipping cost are
  recomputed from your catalog. A hidden `price` field is a suggestion at best.
- **Workflow state.** A checkout that is supposed to go cart, address, payment,
  confirm must refuse `POST /confirm` for an order that never reached payment.

Saltzer and Schroeder called the underlying principle **complete mediation**
in 1975: every access to every object is checked for authority, every time.
Not on the first request of a session, not in the UI, not in a filter that one
route forgot to register.

### Headers that lie: `X-Forwarded-For` and `Host`

**`X-Forwarded-For`** was never standardized; RFC 7239 later defined a
`Forwarded` header for the same job, and the same rules apply to both. Each
proxy **appends** the address it received the connection from. The client can
send its own `X-Forwarded-For` with any addresses it likes, and your proxies
append to that. So the header reads, left to right: whatever the client
invented, then the client's real address as seen by your first proxy, then one
entry per further proxy.

That means the **leftmost** entry, the one naive code takes, is the least
trustworthy. The correct algorithm starts at the **right**, skips entries added
by proxies you operate, and takes the first address that is not one of yours.
And if the TCP peer is not one of your proxies, nobody you trust wrote the
header at all, so ignore it. Mature tools encode exactly this: nginx's
`set_real_ip_from` with `real_ip_recursive on`, Werkzeug's `ProxyFix` with an
explicit `x_for` count, Express's `trust proxy` setting. Their defaults differ,
and the right value depends on how many proxies sit in front of you.

Here is the forged header from the program below, laid out left to right with
who wrote each entry. Start at the right, skip what your own proxies vouch for,
and stop at the first address that is not yours.

```mermaid {title="Read X-Forwarded-For from the right: the leftmost entry is the one the client invented"}
block-beta
  columns 3
  A["192.168.50.20"] B["198.51.100.9"] C["peer 10.0.0.5"]
  A2["written by Mallory: ignore"] B2["appended by our load balancer: the client"] C2["our load balancer: trusted, step left"]
  C2 --> B2
  class A,A2 warn
  class B,B2 good
  class C,C2 neutral
```

Client IP matters for allow-lists, rate limiting, fraud signals, and audit logs.
An attacker who controls it can rotate through addresses to dodge a per-IP rate
limit, or claim an internal address to pass an allow-list. Even computed
correctly, an IP is a weak signal: shared NAT, VPNs, and mobile carriers put
many users behind one address. Use it **in addition to** authentication, never
instead of it.

**`Host`** is how one server hosts many sites, and the client chooses it. Code
that builds absolute URLs from it inherits the attacker's choice. The classic
case is a password-reset email: the handler builds the link from `Host`, the
attacker requests a reset for the victim with `Host: evil.test`, and the victim
receives a genuine email whose link sends the reset token to the attacker.
Caches that key on the path but not the host can be poisoned in the same way.
The fix is to take your own origin from configuration and to reject requests
for hosts you do not serve. Django's `ALLOWED_HOSTS` setting does the second
part; its `USE_X_FORWARDED_HOST` setting is off by default for the reason above.

The reset attack in order: the attacker never sees the victim's inbox, only the
token that the poisoned link delivers.

```mermaid {title="Password-reset poisoning: a link built from Host sends the victim's token to the attacker"}
sequenceDiagram
  autonumber
  actor M as Mallory
  participant A as App
  actor V as Victim
  participant X as evil.test
  M->>A: POST /reset for the victim, Host evil.test
  A->>V: genuine email, link https://evil.test/reset with token T
  V->>X: clicks the link, token T in the URL
  X-->>M: token T
  M->>A: sets a new password with token T
  Note over A: fix: link from BASE_URL, reject hosts you do not serve
```

### Confused deputies

Norm Hardy described the **confused deputy** in 1988. A compiler on a
time-sharing system had permission to write a billing file, so it could record
usage. A user asked the compiler to write its debugging output to a file name
of the user's choosing, and named the billing file. The compiler had the
authority; the user supplied the target; the system had no way to tell that the
compiler was acting for the user rather than for itself.

Web applications build confused deputies constantly, because the server holds
authority the client lacks:

| The deputy | The authority it holds | The attacker supplies |
| --- | --- | --- |
| An API handler | Database access to every customer's rows | An object ID belonging to someone else |
| A URL fetcher (previews, webhooks, imports) | A position inside your network | A URL pointing at an internal service |
| A file server | Read access to the whole disk | A path with `../` in it |
| A browser holding your session cookie | The user's logged-in session | A form on another site that posts to yours |

The pattern is the same each time: **the deputy acts with its own authority on
a target chosen by someone with less authority**. The fix is to check the
request against the requester's authority, not the deputy's: does *this user*
own invoice 1002, may *this user* make the server fetch that address. Later
lessons take each row in turn:
[broken object-level authorization](/notes/application-security/authorization/01-broken-object-level-authorization/),
[server-side request forgery](/notes/application-security/untrusted-input/03-server-side-request-forgery/),
[files and paths](/notes/application-security/untrusted-input/05-files-and-paths/),
and cross-site request forgery in
[sessions and cookies](/notes/application-security/authentication/02-sessions-and-cookies/).

Every row of the table has the same shape. The question is whose authority the
check uses before the deputy acts.

```mermaid {title="A confused deputy lends its own authority to a target someone weaker chose"}
flowchart LR
  U(["Requester, little authority"])
  DP("Deputy: handler, fetcher, file server")
  AU["<b>Deputy's authority</b><br/><small>all rows, internal network, whole disk</small>"]
  X@{ shape: diam, label: "May the requester use this target?" }
  BAD["<b>Acts on the target</b><br/><small>invoice 1002, internal URL, ../ path</small>"]
  OK["<b>Allow, or 404</b>"]
  U -->|"names the target"| DP
  AU -.->|"held by"| DP
  DP --> X
  X -->|"never asked"| BAD
  X -->|"checked against the requester"| OK
  class AU memory
  class BAD warn
  class OK good
```

> [!IMPORTANT]
> A request supplies keys; the server supplies values. A session token, an
> object ID, and a URL are all keys. Who the user is, what they own, and where
> the server may connect are values that only server-owned state can answer.

## Code

The same four routes written twice. The naive handler reads identity from a
header, role from a header, the client IP from the leftmost `X-Forwarded-For`
entry, and the reset link's host from `Host`. The fixed handler looks up the
session, reads the role and object owner from server state, walks
`X-Forwarded-For` from the right, and takes its base URL from configuration.

```python {title="trust_boundary.py"}
"""trust_boundary.py: the same four routes, written twice.

The naive handler believes what the request says about itself. The fixed
handler derives every security decision from state the server owns. Standard
library only; offline; the "network" is a list of simulated requests.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field

# Server-side state. The client can name these keys but cannot change the values.
SESSIONS = {"s-7f3a9c": "alice", "s-b81e04": "mallory"}  # real tokens: secrets.token_urlsafe(32)
ROLES = {"alice": "user", "mallory": "user", "root": "admin"}
INVOICES = {"1001": "alice", "1002": "bob"}
TRUSTED_PROXIES = [ipaddress.ip_network("10.0.0.0/8")]  # our load balancers
ADMIN_NETWORK = ipaddress.ip_network("192.168.50.0/24")  # the office
BASE_URL = "https://app.example.com"  # configuration, never the Host header


@dataclass
class Request:
    path: str
    peer: str  # the TCP peer address: the only field the client did not write
    headers: dict[str, str] = field(default_factory=dict)
    cookies: dict[str, str] = field(default_factory=dict)


# ---------- naive: every decision reads a field the attacker wrote ----------

def naive(req: Request) -> str:
    user = req.headers.get("X-User-Id", "anonymous")
    if req.path == "/admin":
        role = req.headers.get("X-Role", "user")
        ip = req.headers.get("X-Forwarded-For", req.peer).split(",")[0].strip()
        ok = role == "admin" or ipaddress.ip_address(ip) in ADMIN_NETWORK
        return "200 admin console" if ok else "403"
    if req.path.startswith("/invoices/"):
        return f"200 invoice {req.path.rsplit('/', 1)[1]} for {user}"
    if req.path == "/reset":
        return f"200 mail: https://{req.headers.get('Host')}/reset"
    return f"200 hello {user}"


# ---------- fixed: decisions come from server-owned state ----------

def trusted(addr: str) -> bool:
    return any(ipaddress.ip_address(addr) in net for net in TRUSTED_PROXIES)


def client_ip(req: Request) -> str:
    """Walk X-Forwarded-For from the right. Each hop we trust vouches for the
    address to its left; the first untrusted address is the client."""
    if not trusted(req.peer):
        return req.peer  # nobody we trust added the header; ignore it
    hops = [h.strip() for h in req.headers.get("X-Forwarded-For", "").split(",") if h.strip()]
    for hop in reversed(hops):
        if not trusted(hop):
            return hop
    return req.peer


def fixed(req: Request) -> str:
    user = SESSIONS.get(req.cookies.get("session", ""))  # lookup, not belief
    if user is None:
        return "401 no valid session"
    if req.path == "/admin":
        in_office = ipaddress.ip_address(client_ip(req)) in ADMIN_NETWORK
        ok = ROLES.get(user) == "admin" and in_office  # network is extra, not instead
        return "200 admin console" if ok else "403"
    if req.path.startswith("/invoices/"):
        inv = req.path.rsplit("/", 1)[1]
        if INVOICES.get(inv) != user:
            return "404"  # same answer as "does not exist"
        return f"200 invoice {inv} for {user}"
    if req.path == "/reset":
        return f"200 mail: {BASE_URL}/reset"
    return f"200 hello {user}"


CASES = [
    ("alice reads her own invoice",
     Request("/invoices/1001", "10.0.0.5", {"X-User-Id": "alice", "X-Forwarded-For": "203.0.113.7"},
             {"session": "s-7f3a9c"})),
    ("mallory claims to be alice",
     Request("/", "10.0.0.5", {"X-User-Id": "alice", "X-Forwarded-For": "198.51.100.9"},
             {"session": "s-b81e04"})),
    ("mallory sends X-Role: admin",
     Request("/admin", "10.0.0.5", {"X-Role": "admin", "X-Forwarded-For": "198.51.100.9"},
             {"session": "s-b81e04"})),
    ("mallory forges an office XFF",
     Request("/admin", "10.0.0.5", {"X-Forwarded-For": "192.168.50.20, 198.51.100.9"},
             {"session": "s-b81e04"})),
    ("mallory reads invoice 1002",
     Request("/invoices/1002", "10.0.0.5", {"X-User-Id": "bob", "X-Forwarded-For": "198.51.100.9"},
             {"session": "s-b81e04"})),
    ("reset with Host: evil.test",
     Request("/reset", "10.0.0.5", {"Host": "evil.test", "X-Forwarded-For": "198.51.100.9"},
             {"session": "s-b81e04"})),
    ("no cookie, any headers",
     Request("/", "198.51.100.9", {"X-User-Id": "root", "X-Forwarded-For": "10.0.0.1"})),
]

if __name__ == "__main__":
    print(f"{'case':<30} {'naive':<34} fixed")
    for label, req in CASES:
        print(f"{label:<30} {naive(req):<34} {fixed(req)}")
    forged = CASES[3][1]
    print(f"\nforged XFF {forged.headers['X-Forwarded-For']!r} -> client {client_ip(forged)}")
```

Run it with `python3 trust_boundary.py`:

```text
case                           naive                              fixed
alice reads her own invoice    200 invoice 1001 for alice         200 invoice 1001 for alice
mallory claims to be alice     200 hello alice                    200 hello mallory
mallory sends X-Role: admin    200 admin console                  403
mallory forges an office XFF   200 admin console                  403
mallory reads invoice 1002     200 invoice 1002 for bob           404
reset with Host: evil.test     200 mail: https://evil.test/reset  200 mail: https://app.example.com/reset
no cookie, any headers         200 hello root                     401 no valid session

forged XFF '192.168.50.20, 198.51.100.9' -> client 198.51.100.9
```

Every naive failure is the same bug: a decision read from a field Mallory
wrote. Note the invoice case. The fixed handler answers `404`, not `403`, so it
does not confirm that invoice 1002 exists. The forged-header line shows why
walking from the right works: Mallory's invented `192.168.50.20` sits to the
left of the address the load balancer actually saw.

## Where it breaks

- **The trusted-proxy list is configuration, and it rots.** Add a CDN in front
  of the load balancer and forget to add its ranges, and `client_ip` returns the
  CDN's address for every user. Add too broad a range (all of `10.0.0.0/8`
  when tenants also live there) and an internal attacker can forge the header.
- **The session store is only as good as the token.** The demo uses fixed
  strings so the output is reproducible. Real tokens must be long and random,
  sent only over HTTPS with `Secure`, `HttpOnly`, and an appropriate `SameSite`
  attribute, and rotated at login.
- **A valid session is not authorization.** The fixed handler checks ownership
  for invoices because the demo has one object type. Real applications have
  hundreds of routes, and the one that forgets the check is the vulnerability.
  That is why authorization belongs in one place, the subject of
  [centralizing policy](/notes/application-security/authorization/04-centralizing-policy/).
- **Ambient credentials still flow.** A session cookie proves the browser holds
  the session, not that the user meant to send this request. A form on another
  site can make the browser send it. That is cross-site request forgery, and it
  needs its own defense.
- **Gateways that inject identity are fine until a second path exists.** The
  demo has no gateway. In a real deployment, verify that the backend refuses
  traffic that did not come through the gateway, and that the gateway strips
  inbound copies of the headers it sets.
- **IP-based controls are weak by nature.** Correctly computing the client IP
  does not make it an identity. The fixed handler requires the admin role *and*
  the office network; the network check alone would not be enough.

## Remember this

- Every field of a request, including `Host`, cookies, and `X-Forwarded-For`, is
  written by the client.
- A request makes claims; a check against server-owned state turns a claim into
  a fact.
- Client-side checks are user experience; every rule that matters runs on the
  server, on every request.
- Read `X-Forwarded-For` from the right, and only when the peer is your own
  proxy.
- Build URLs from configuration, never from `Host`.
- A confused deputy uses its own authority on a target the attacker chose;
  check the requester's authority instead.

## Try it

1. Run `trust_boundary.py`. Add a case where Mallory connects directly
   (peer `198.51.100.9`) with `X-Forwarded-For: 192.168.50.20`. Predict what
   `client_ip` returns before you run it.
2. Add a CDN in front of the load balancer: requests now arrive with two
   trusted hops appended. Which line has to change, and what happens to every
   admin request if you forget?
3. Add a `POST /checkout` route whose body carries `item` and `price`. Write
   the naive version, then a fixed version that ignores `price` and reads it
   from a catalog dictionary.
4. Pick a service you work on. List every place it reads a header other than
   `Authorization` and `Cookie`. For each, write down who can set it and what
   would happen if an attacker did.

## Check yourself

1. A service behind an API gateway reads the user ID from `X-User-Id`, which
   the gateway sets after validating a token. Under what conditions is that
   safe?

   {{< details summary="Show answer" >}}
   Only if the gateway removes any `X-User-Id` the client sent before setting
   its own, and the service accepts connections only from the gateway (enforced
   by network policy or mutual TLS). If any other path reaches the service, the
   header is attacker-controlled again. A token signed by the gateway, which
   the service verifies itself, removes the dependency on network topology.
   {{< /details >}}

2. Why is the leftmost `X-Forwarded-For` entry the least trustworthy?

   {{< details summary="Show answer" >}}
   Proxies append to whatever header arrived. Anything the client sent is at
   the left; the entries your own proxies added are at the right. The leftmost
   entry is therefore the one the client wrote, which is why the correct
   algorithm walks from the right and stops at the first address that is not
   one of your proxies.
   {{< /details >}}

3. A form disables its "price" input and validates the quantity in JavaScript.
   What does the server still have to do?

   {{< details summary="Show answer" >}}
   Everything. It must ignore any submitted price and compute the price from its
   own catalog, validate the quantity range itself, and check that the user may
   buy the item. The attacker sends the request without running the page, so a
   disabled input and a JavaScript check constrain nothing.
   {{< /details >}}

4. How does the password-reset `Host` attack work, and what stops it?

   {{< details summary="Show answer" >}}
   The attacker requests a reset for the victim's account with `Host:
   evil.test`. If the handler builds the link from `Host`, the victim receives a
   genuine email whose link points at the attacker's server, and clicking it
   delivers the reset token to the attacker. Building links from a configured
   base URL, and rejecting requests for hosts you do not serve, stops it.
   {{< /details >}}

5. In what sense is an API handler that returns any invoice by ID a confused
   deputy?

   {{< details summary="Show answer" >}}
   The handler holds the authority to read every invoice in the database. The
   attacker, who has authority over only their own invoices, chooses the target
   by supplying another user's ID. The handler acts on its own authority rather
   than the requester's. The fix is to check that this user owns, or may read,
   this specific invoice.
   {{< /details >}}

## Sources

- R. Fielding, M. Nottingham, J. Reschke (eds.), [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110), IETF, June 2022. Section 7.2 defines `Host`.
- A. Petersson, M. Nilsson, [RFC 7239: Forwarded HTTP Extension](https://www.rfc-editor.org/rfc/rfc7239), IETF, June 2014.
- A. Barth, [RFC 6265: HTTP State Management Mechanism](https://www.rfc-editor.org/rfc/rfc6265), IETF, April 2011. Section 8.6 covers weak integrity of cookies.
- Norm Hardy, "The Confused Deputy (or why capabilities might have been invented)", *ACM SIGOPS Operating Systems Review* 22(4), October 1988.
- J. H. Saltzer, M. D. Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), September 1975.
- OWASP, [Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/).
- nginx, [ngx_http_realip_module](https://nginx.org/en/docs/http/ngx_http_realip_module.html).
- Django, [Settings: ALLOWED_HOSTS and USE_X_FORWARDED_HOST](https://docs.djangoproject.com/en/stable/ref/settings/#allowed-hosts).
