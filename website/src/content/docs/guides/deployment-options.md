---
title: Deployment options
description: Kubernetes and Docker Compose are both in the box — when to reach for each, and when neither is worth the operational cost.
---

**The big picture:** Blueprint ships CI templates for Kubernetes (Helm) and for plain
Docker builds — but the right deployment is often simpler than either.

**Why it matters:** Deployment infrastructure is a running cost, not a one-time choice.
Picking more than you need taxes every release; picking less than you need is usually
cheap to fix later.

**The short version:**
- **Kubernetes + Helm** — when you genuinely need multi-host scheduling, automatic
  failover, or autoscaling, or your organization already runs a cluster.
- **Docker Compose** — one host or a small fixed fleet. Often the right long-term answer,
  not a stepping stone.
- **Simpler still** — a single container, a systemd service, or a PaaS. Perfectly good
  for an MVP or a team of one.

## Kubernetes and Helm — for production at scale

`ci/helm.yml` ships a Helm chart CI template: a registry-drift gate that catches a
plain `X.Y.Z` release silently outranking every `X.Y.Z-beta.N` forever, and an
install-then-upgrade drill so the upgrade path — the one every real operator actually
takes — is exercised in CI rather than only a fresh install.

It's in the box because Kubernetes has stopped being a specialist choice for a
production, at-scale deployable app. Most cloud providers and platform teams already
standardize on it, and it buys you things that are genuinely hard to hand-roll well:
rolling deploys, self-healing on pod failure, horizontal scaling, and a declarative
deployment surface that's become the common language between infra and app teams.
Standing up trustworthy chart-testing infrastructure from a blank page is real work —
this template exists so a project that has actually reached the point of needing
Kubernetes does not have to build that infrastructure from scratch to get a green
pipeline it can trust.

That "actually reached the point of needing" is the important qualifier. Kubernetes
also buys you a control plane, RBAC, an ingress controller, and an operational
surface that has to be staffed. If nothing in your project needs the things above,
adopting Kubernetes for its own sake is pure cost.

## Docker Compose — for everything that still wants containers, without a cluster

`ci/docker.yml` verifies a Docker build (via kaniko, no privileged mode required) on
every relevant change. Paired with a `docker-compose.yml` at deploy time, this covers
a large share of real projects: early-stage products, internal tools, and
single-team services at modest traffic all get containerized, declarative,
multi-service deployment from `docker compose up`, without a cluster to operate.

This is not a lesser version of Kubernetes waiting to be outgrown — for a service
that runs on one host or a small fixed fleet, Compose is often the *correct* long-term
answer, not a stepping stone. Reach for Kubernetes when you hit a real requirement
Compose can't meet (multi-host scheduling, automated failover, horizontal autoscaling
under real load) — not on the assumption that you eventually will.

## Simpler than either

Both of the above assume you want containers at all. Plenty of projects don't need
that yet:

| Option | What it looks like | Good fit for |
|---|---|---|
| **A single `docker run`** | One container, one host, a reverse proxy (Caddy/nginx) in front | A single service with no dependencies to orchestrate |
| **A systemd unit** | A bare binary or process, a `systemd` service file, a plain deploy script (`rsync`/`scp` + restart) | No containers at all — smallest possible operational surface |
| **A PaaS** (Fly.io, Render, Railway, and similar) | `git push`, the platform builds and runs it | Trading operational control for near-zero deployment complexity |

These aren't a lesser tier either. For a side project, an MVP, or a team of one, the
right amount of deployment infrastructure is often none of the above three sections —
it's whichever of these gets you shipping today, with room to move up the ladder only
if you actually hit its ceiling.

## Choosing

None of this is a purely technical decision. Weigh:

- **Team size** — a systemd unit or a PaaS needs no dedicated operator; Kubernetes
  effectively does, even managed
- **Availability and traffic needs** — most projects overestimate this at the start;
  underestimating it later is cheaper to fix than paying Kubernetes' overhead early
- **Existing platform investment** — if your organization already runs a Kubernetes
  cluster, the marginal cost of one more Helm chart is much lower than standing up
  Kubernetes for the first time
- **Number of services** — a single service rarely justifies Kubernetes on its own;
  several interdependent services with their own scaling needs is where it starts
  to earn its cost

## Nothing here is mandatory

Delete the `ci/*.yml` templates you don't need — see
[What's included → Removing what you don't need](/reference/whats-included/#removing-what-you-dont-need).
Keeping a template around unused costs nothing at rest, but a template you've kept
without a reason to is a decision nobody made on purpose.
