#!/usr/bin/env bash
# scripts/tests/lib/app-fixture.sh — writes the application fixture that
# scripts/tests/app-fixture-gates.test.sh runs the application-aware gates
# against. Sourced, not executed.
#
# ## Why it is generated, not committed
#
# Blueprint is stack-agnostic, and a project starts life as a clone of this
# repository. A concrete Django/DRF/Channels/React app committed to the tree
# would land verbatim in every downstream project, with nothing telling the
# adopter it is gate-test scaffolding. So the fixture exists only inside a
# temp directory for the duration of a test run.
#
# ## What it contains
#
# A small Django/DRF-and-React-shaped app written in the shapes real tooling
# emits: a drf-spectacular OpenAPI 3.0 document (including the
# oneOf[XEnum, BlankEnum, NullEnum] rendering of a null=True choice field),
# TypeScript types using `extends` and union aliases, Django migrations, a
# Channels routing file, write-path broadcasts, and coverage.py / vitest v8
# Cobertura reports. Nothing in it is installed or executed; the gates parse
# it statically. When extending it, copy what the real generator produces —
# do not paraphrase it, or parser and fixture agree by construction.
#
# Coverage reports are written under reports/ (not at their real paths)
# because the runner builds git repos from backend/ and frontend/ and places
# the reports as untracked build output, as CI would.

# generate_fixture <root> — write the fixture tree under <root>.
generate_fixture() {
  local root="$1"
  mkdir -p "$root/backend" \
    "$root/backend/tasks" \
    "$root/backend/tasks/migrations" \
    "$root/backend/tasks/tests" \
    "$root/docs" \
    "$root/docs/api" \
    "$root/frontend" \
    "$root/frontend/src/components" \
    "$root/frontend/src/types" \
    "$root/reports"

  cat > "$root/backend/.coveragerc" <<'FIXTURE_EOF'
[run]
source = .
branch = true
omit =
    */tests/*
    */migrations/*
    manage.py

[report]
skip_empty = false
FIXTURE_EOF

  cat > "$root/backend/routing.py" <<'FIXTURE_EOF'
"""Toy Channels routing: the only groups a client can join are project groups."""

from django.urls import re_path

from tasks.consumers import ProjectConsumer

websocket_urlpatterns = [
    re_path(r"^ws/projects/(?P<project_id>[0-9a-f-]+)/$", ProjectConsumer.as_asgi()),
]
FIXTURE_EOF
  : > "$root/backend/tasks/__init__.py"

  cat > "$root/backend/tasks/events.py" <<'FIXTURE_EOF'
"""Write-path broadcasts, deferred until the transaction commits."""

from django.db import transaction

from .realtime import broadcast_event, group_name


def task_updated(task):
    transaction.on_commit(lambda: broadcast_event(group_name("project", task.project_id), "task_updated", {"id": str(task.id)}))


def task_deleted(project_id, task_id):
    transaction.on_commit(
        lambda: broadcast_event(
            group_name("project", str(project_id)),
            "task_deleted",
            {"id": str(task_id)},
        )
    )


def program_rollup_changed(program):
    # Fans out on the PROGRAM group. routing.py has no program route yet, so no
    # client can join this group — the taxonomy must say so.
    transaction.on_commit(
        lambda: broadcast_event(
            group_name("program", program.id),
            "program_rollup_changed",
            {"program": str(program.id)},
        )
    )
FIXTURE_EOF

  cat > "$root/backend/tasks/migrations/0001_initial.py" <<'FIXTURE_EOF'
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(name="Task", fields=[("title", models.CharField(max_length=200))]),
    ]
FIXTURE_EOF

  cat > "$root/backend/tasks/migrations/0002_task_priority.py" <<'FIXTURE_EOF'
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tasks", "0001_initial")]
    operations = [
        migrations.AddField("task", "priority", models.CharField(max_length=10, null=True, blank=True)),
    ]
FIXTURE_EOF
  : > "$root/backend/tasks/migrations/__init__.py"

  cat > "$root/backend/tasks/models.py" <<'FIXTURE_EOF'
"""Toy Django-shaped models for the gate fixture. Never imported or executed."""

import uuid

from django.conf import settings
from django.db import models


class Program(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(Program, on_delete=models.CASCADE, related_name="projects")
    name = models.CharField(max_length=200)


class Task(models.Model):
    class Status(models.TextChoices):
        TODO = "todo", "To do"
        IN_PROGRESS = "in_progress", "In progress"
        DONE = "done", "Done"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO)
    # null=True + blank=True on a choice field is the shape drf-spectacular
    # renders as oneOf[PriorityEnum, BlankEnum, NullEnum].
    priority = models.CharField(max_length=10, choices=Priority.choices, null=True, blank=True)
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    due_date = models.DateField(null=True, blank=True)
    estimate_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    tags = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    server_version = models.BigIntegerField(default=0)
FIXTURE_EOF

  cat > "$root/backend/tasks/realtime.py" <<'FIXTURE_EOF'
"""Toy real-time fan-out helpers. Group names are what a client joins."""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def group_name(kind: str, obj_id) -> str:
    """One channel-layer group per (kind, id): what a client subscribes to."""
    return f"{kind}_{obj_id}"


def broadcast_event(group, event, payload):
    async_to_sync(get_channel_layer().group_send)(group, {"type": "event", "event": event, "payload": payload})
FIXTURE_EOF

  cat > "$root/backend/tasks/serializers.py" <<'FIXTURE_EOF'
"""Toy DRF-shaped serializers. docs/api/openapi.json is what drf-spectacular
would emit for them; the parity gate reads that document, not this file."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Task


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "email", "full_name"]

    def get_full_name(self, obj) -> str:
        return obj.get_full_name()


class TaskSerializer(serializers.ModelSerializer):
    assignee = UserSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Task
        fields = [
            "id", "title", "status", "priority", "assignee",
            "due_date", "estimate_hours", "tags", "created_at", "server_version",
        ]
        read_only_fields = ["id", "created_at", "server_version"]


class TaskDetailSerializer(TaskSerializer):
    watchers = UserSerializer(many=True, read_only=True)

    class Meta(TaskSerializer.Meta):
        fields = [*TaskSerializer.Meta.fields, "description", "watchers"]
FIXTURE_EOF
  : > "$root/backend/tasks/tests/__init__.py"

  cat > "$root/backend/tasks/tests/test_events.py" <<'FIXTURE_EOF'
from unittest import mock

from tasks import events


def test_task_updated_broadcasts_on_commit():
    with mock.patch("tasks.events.transaction.on_commit") as on_commit:
        events.task_updated(mock.Mock(project_id="p1", id="t1"))
    on_commit.assert_called_once()
FIXTURE_EOF

  cat > "$root/docs/api/openapi.json" <<'FIXTURE_EOF'
{
  "openapi": "3.0.3",
  "info": {
    "title": "Fixture API",
    "version": "0.0.0"
  },
  "paths": {
    "/api/v1/tasks/": {
      "get": {
        "operationId": "tasks_list",
        "tags": [
          "tasks"
        ],
        "parameters": [
          {
            "name": "page",
            "required": false,
            "in": "query",
            "schema": {
              "type": "integer"
            }
          }
        ],
        "security": [
          {
            "jwtAuth": []
          }
        ],
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PaginatedTaskList"
                }
              }
            },
            "description": ""
          }
        }
      }
    },
    "/api/v1/tasks/{id}/": {
      "get": {
        "operationId": "tasks_retrieve",
        "tags": [
          "tasks"
        ],
        "parameters": [
          {
            "in": "path",
            "name": "id",
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true
          }
        ],
        "security": [
          {
            "jwtAuth": []
          }
        ],
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TaskDetail"
                }
              }
            },
            "description": ""
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "BlankEnum": {
        "enum": [
          ""
        ]
      },
      "NullEnum": {
        "enum": [
          null
        ]
      },
      "PaginatedTaskList": {
        "type": "object",
        "required": [
          "count",
          "results"
        ],
        "properties": {
          "count": {
            "type": "integer",
            "example": 123
          },
          "next": {
            "type": "string",
            "nullable": true,
            "format": "uri",
            "example": "http://api.example.org/accounts/?page=4"
          },
          "previous": {
            "type": "string",
            "nullable": true,
            "format": "uri",
            "example": "http://api.example.org/accounts/?page=2"
          },
          "results": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Task"
            }
          }
        }
      },
      "PriorityEnum": {
        "enum": [
          "low",
          "medium",
          "high"
        ],
        "type": "string",
        "description": "* `low` - Low\n* `medium` - Medium\n* `high` - High"
      },
      "StatusEnum": {
        "enum": [
          "todo",
          "in_progress",
          "done"
        ],
        "type": "string",
        "description": "* `todo` - To do\n* `in_progress` - In progress\n* `done` - Done"
      },
      "Task": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
            "readOnly": true
          },
          "title": {
            "type": "string",
            "maxLength": 200
          },
          "status": {
            "$ref": "#/components/schemas/StatusEnum"
          },
          "priority": {
            "nullable": true,
            "oneOf": [
              {
                "$ref": "#/components/schemas/PriorityEnum"
              },
              {
                "$ref": "#/components/schemas/BlankEnum"
              },
              {
                "$ref": "#/components/schemas/NullEnum"
              }
            ]
          },
          "assignee": {
            "allOf": [
              {
                "$ref": "#/components/schemas/User"
              }
            ],
            "readOnly": true,
            "nullable": true
          },
          "due_date": {
            "type": "string",
            "format": "date",
            "nullable": true
          },
          "estimate_hours": {
            "type": "string",
            "format": "decimal",
            "pattern": "^-?\\d{0,4}(?:\\.\\d{0,2})?$",
            "nullable": true
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "created_at": {
            "type": "string",
            "format": "date-time",
            "readOnly": true
          },
          "server_version": {
            "type": "integer",
            "maximum": 9223372036854775807,
            "minimum": -9223372036854775808,
            "format": "int64",
            "readOnly": true
          }
        },
        "required": [
          "assignee",
          "created_at",
          "id",
          "server_version",
          "title"
        ]
      },
      "TaskDetail": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
            "readOnly": true
          },
          "title": {
            "type": "string",
            "maxLength": 200
          },
          "status": {
            "$ref": "#/components/schemas/StatusEnum"
          },
          "priority": {
            "nullable": true,
            "oneOf": [
              {
                "$ref": "#/components/schemas/PriorityEnum"
              },
              {
                "$ref": "#/components/schemas/BlankEnum"
              },
              {
                "$ref": "#/components/schemas/NullEnum"
              }
            ]
          },
          "assignee": {
            "allOf": [
              {
                "$ref": "#/components/schemas/User"
              }
            ],
            "readOnly": true,
            "nullable": true
          },
          "due_date": {
            "type": "string",
            "format": "date",
            "nullable": true
          },
          "estimate_hours": {
            "type": "string",
            "format": "decimal",
            "pattern": "^-?\\d{0,4}(?:\\.\\d{0,2})?$",
            "nullable": true
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "created_at": {
            "type": "string",
            "format": "date-time",
            "readOnly": true
          },
          "server_version": {
            "type": "integer",
            "maximum": 9223372036854775807,
            "minimum": -9223372036854775808,
            "format": "int64",
            "readOnly": true
          },
          "description": {
            "type": "string"
          },
          "watchers": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/User"
            },
            "readOnly": true
          }
        },
        "required": [
          "assignee",
          "created_at",
          "id",
          "server_version",
          "title",
          "watchers"
        ]
      },
      "User": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "readOnly": true
          },
          "username": {
            "type": "string",
            "description": "Required. 150 characters or fewer.",
            "pattern": "^[\\w.@+-]+$",
            "maxLength": 150
          },
          "email": {
            "type": "string",
            "format": "email",
            "title": "Email address",
            "maxLength": 254
          },
          "full_name": {
            "type": "string",
            "readOnly": true
          }
        },
        "required": [
          "full_name",
          "id",
          "username"
        ]
      }
    },
    "securitySchemes": {
      "jwtAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      }
    }
  }
}
FIXTURE_EOF

  cat > "$root/docs/websockets.md" <<'FIXTURE_EOF'
# Real-time events

Connect to `ws/projects/<project_id>/` to receive the events below.

## Event taxonomy

- `task_updated` — a task's fields changed. Payload: `{"id": "<uuid>"}`.
- `task_deleted` — a task was removed. Payload: `{"id": "<uuid>"}`.
- `program_rollup_changed` — a program-level rollup was recomputed.
  **Not deliverable yet:** it fans out on the program group, and no route
  lets a client join that group. Listed so integrators do not build on it;
  not deliverable until a program route ships.

| Event | Group | Notes |
|---|---|---|
| `task_updated` | project | |
| `task_deleted` | project | |
| `program_rollup_changed` | program | not deliverable (no program route) |
FIXTURE_EOF

  cat > "$root/frontend/src/components/TaskCard.test.tsx" <<'FIXTURE_EOF'
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { TaskCard } from "./TaskCard";

it("renders the title", () => {
  const task = { id: "t1", title: "Write fixture", priority: null } as never;
  render(<TaskCard task={task} onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Write fixture/ })).toBeTruthy();
});
FIXTURE_EOF

  cat > "$root/frontend/src/components/TaskCard.tsx" <<'FIXTURE_EOF'
import type { TaskCardProps } from "../types";

export function TaskCard({ task, onSelect }: TaskCardProps) {
  return (
    <button type="button" onClick={() => onSelect(task.id)}>
      {task.title}
      {task.priority ? <span className="badge">{task.priority}</span> : null}
    </button>
  );
}
FIXTURE_EOF

  cat > "$root/frontend/src/types/index.ts" <<'FIXTURE_EOF'
/**
 * Shared API types — hand-maintained against docs/api/openapi.json.
 * (A `//` inside a string such as "https://example.test" is not a comment.)
 */

export type TaskStatus = "todo" | "in_progress" | "done";
export type Priority = "low" | "medium" | "high";

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
}

export interface Task {
  readonly id: string;
  title: string;
  status: TaskStatus;
  priority: Priority | null;
  assignee: User | null;
  due_date: string | null;
  // DRF DecimalField serializes as a string by default.
  estimate_hours: string | null;
  tags: string[];
  readonly created_at: string;
  readonly server_version: number;
}

export interface TaskDetail extends Task {
  description: string;
  watchers: User[];
}

export interface PaginatedTaskList {
  count: number;
  next: string | null;
  previous: string | null;
  results: Task[];
}

/** Client-only view state; no schema counterpart, so the auto-map skips it. */
export interface TaskCardProps {
  task: Task;
  onSelect: (id: string) => void;
}
FIXTURE_EOF

  cat > "$root/frontend/vitest.config.ts" <<'FIXTURE_EOF'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "cobertura"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.*", "src/types/**", "src/vite-env.d.ts"],
    },
  },
});
FIXTURE_EOF

  cat > "$root/reports/backend-coverage.xml" <<'FIXTURE_EOF'
<?xml version="1.0" ?>
<coverage version="7.6.1" timestamp="1790000000000" lines-valid="31" lines-covered="27" line-rate="0.871" branches-covered="0" branches-valid="0" branch-rate="0" complexity="0">
	<!-- Generated by coverage.py: https://coverage.readthedocs.io/en/7.6.1 -->
	<sources>
		<source>/builds/acme/app/backend</source>
	</sources>
	<packages>
		<package name="." line-rate="1" branch-rate="0" complexity="0">
			<classes>
				<class name="routing.py" filename="routing.py" complexity="0" line-rate="1" branch-rate="0">
					<methods/>
					<lines>
						<line number="3" hits="1"/>
					</lines>
				</class>
			</classes>
		</package>
		<package name="tasks" line-rate="0.85" branch-rate="0" complexity="0">
			<classes>
				<class name="__init__.py" filename="tasks/__init__.py" complexity="0" line-rate="1" branch-rate="0">
					<methods/>
					<lines/>
				</class>
				<class name="events.py" filename="tasks/events.py" complexity="0" line-rate="0.6" branch-rate="0">
					<methods/>
					<lines>
						<line number="3" hits="1"/>
						<line number="8" hits="1"/>
					</lines>
				</class>
				<class name="models.py" filename="tasks/models.py" complexity="0" line-rate="1" branch-rate="0">
					<methods/>
					<lines>
						<line number="3" hits="1"/>
					</lines>
				</class>
				<class name="realtime.py" filename="tasks/realtime.py" complexity="0" line-rate="0.8" branch-rate="0">
					<methods/>
					<lines>
						<line number="3" hits="1"/>
					</lines>
				</class>
				<class name="serializers.py" filename="tasks/serializers.py" complexity="0" line-rate="1" branch-rate="0">
					<methods/>
					<lines>
						<line number="4" hits="1"/>
					</lines>
				</class>
			</classes>
		</package>
	</packages>
</coverage>
FIXTURE_EOF

  cat > "$root/reports/frontend-cobertura.xml" <<'FIXTURE_EOF'
<?xml version="1.0" ?>
<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">
<coverage lines-valid="6" lines-covered="6" line-rate="1" branches-valid="2" branches-covered="1" branch-rate="0.5" timestamp="1790000000000" complexity="0" version="0.1">
  <sources>
    <source>/builds/acme/app/frontend</source>
  </sources>
  <packages>
    <package name="src.components" line-rate="1" branch-rate="0.5">
      <classes>
        <class name="TaskCard.tsx" filename="src/components/TaskCard.tsx" line-rate="1" branch-rate="0.5">
          <methods>
            <method name="TaskCard" hits="1" signature="()V">
              <lines>
                <line number="3" hits="1"/>
              </lines>
            </method>
          </methods>
          <lines>
            <line number="3" hits="1"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
FIXTURE_EOF
}
