# Use Case Scenarios - TaskFlow Task Management System

## Overview

This document describes the key user scenarios for testing the TaskFlow application generated from the BRD specification.

---

## Scenario 1: New User Onboarding

### Description
Sarah is a freelance designer who wants to organize her client projects. She discovers TaskFlow and signs up to manage her work.

### Steps
1. Sarah visits the registration page
2. She enters her email: `sarah@design.co`
3. She chooses username: `sarah_designs`
4. She creates a password: `SecurePass123`
5. System creates her account and logs her in
6. She sees an empty dashboard prompting her to create her first project

### Expected Results
- Account is created successfully
- JWT token is returned for authentication
- User can access protected endpoints
- Dashboard shows zero projects/tasks

### API Calls
```
POST /api/auth/register
  Body: { "email": "sarah@design.co", "username": "sarah_designs", "password": "SecurePass123" }
  Response: 201 { "id": 1, "email": "sarah@design.co", "username": "sarah_designs" }

POST /api/auth/login
  Body: { "email": "sarah@design.co", "password": "SecurePass123" }
  Response: 200 { "access_token": "eyJ...", "token_type": "bearer" }
```

---

## Scenario 2: Creating a Project and Tasks

### Description
Sarah creates a new project for her client "Acme Corp" and adds several tasks for the website redesign work.

### Steps
1. Sarah clicks "New Project"
2. She enters project name: "Acme Corp Website"
3. She adds description: "Complete website redesign for Q1 2026"
4. She selects purple as the project color: "#8B5CF6"
5. She creates the following tasks:
   - "Gather requirements from client" (high priority, due in 3 days)
   - "Create wireframes" (medium priority, due in 1 week)
   - "Design homepage mockup" (medium priority, due in 2 weeks)
   - "Design inner pages" (low priority, due in 3 weeks)
   - "Client review meeting" (urgent priority, due in 2 weeks)

### Expected Results
- Project appears in her project list
- All 5 tasks are created with correct priorities
- Tasks default to "todo" status
- Due dates are properly set

### API Calls
```
POST /api/projects
  Body: { "name": "Acme Corp Website", "description": "Complete website redesign for Q1 2026", "color": "#8B5CF6" }
  Response: 201 { "id": 1, "name": "Acme Corp Website", ... }

POST /api/projects/1/tasks
  Body: { "title": "Gather requirements from client", "priority": "high", "due_date": "2026-02-01" }
  Response: 201 { "id": 1, "title": "...", "status": "todo", "priority": "high", ... }

# Repeat for other tasks...
```

---

## Scenario 3: Organizing Tasks with Labels

### Description
Sarah wants to categorize her tasks by type (Design, Client, Development) to quickly filter and find related work.

### Steps
1. Sarah creates three labels for the project:
   - "Design" (color: #EC4899 - pink)
   - "Client" (color: #F59E0B - orange)
   - "Development" (color: #10B981 - green)
2. She adds the "Client" label to "Gather requirements" and "Client review meeting"
3. She adds the "Design" label to "Create wireframes", "Design homepage mockup", and "Design inner pages"
4. She filters tasks by "Design" label to see only design-related work

### Expected Results
- Labels are created with correct colors
- Tasks show associated labels
- Filtering returns only tasks with matching labels

### API Calls
```
POST /api/projects/1/labels
  Body: { "name": "Design", "color": "#EC4899" }
  Response: 201 { "id": 1, "name": "Design", "color": "#EC4899" }

POST /api/tasks/1/labels/2
  Response: 200 { "task_id": 1, "labels": [{ "id": 2, "name": "Client" }] }
```

---

## Scenario 4: Tracking Task Progress

### Description
Sarah starts working on her tasks and updates their status as she progresses through the project.

### Steps
1. Sarah completes gathering requirements - marks task as "done"
2. She starts working on wireframes - marks task as "in_progress"
3. She finishes wireframes and sends for review - marks task as "review"
4. Client approves wireframes - marks task as "done"
5. She checks the dashboard to see her progress

### Expected Results
- Task statuses update correctly
- When status = "done", `completed_at` is set automatically
- Dashboard stats show:
  - 2 tasks completed
  - Completion by status breakdown
  - Remaining tasks by priority

### API Calls
```
PUT /api/tasks/1
  Body: { "status": "done" }
  Response: 200 { "id": 1, "status": "done", "completed_at": "2026-01-29T10:30:00Z", ... }

GET /api/dashboard/stats
  Response: 200 {
    "total_tasks": 5,
    "completed_today": 2,
    "overdue": 0,
    "by_priority": { "low": 1, "medium": 2, "high": 1, "urgent": 1 },
    "by_status": { "todo": 2, "in_progress": 0, "review": 0, "done": 3 }
  }
```

---

## Scenario 5: Handling Overdue Tasks

### Description
Sarah has been busy and some tasks are now past their due date. She needs to identify and reprioritize overdue work.

### Steps
1. It's now February 5th, and "Gather requirements" (due Feb 1) was never completed
2. Sarah views her dashboard and sees 1 overdue task
3. She views upcoming tasks for the week
4. She updates the overdue task with a new due date
5. She changes its priority to "urgent"

### Expected Results
- Overdue task is flagged in the system
- Dashboard shows overdue count
- Task can be updated with new due date
- Priority change is saved

### API Calls
```
GET /api/dashboard/stats
  Response: 200 { "overdue": 1, ... }

GET /api/dashboard/upcoming
  Response: 200 [
    { "id": 1, "title": "Gather requirements", "due_date": "2026-02-01", "is_overdue": true },
    { "id": 2, "title": "Create wireframes", "due_date": "2026-02-05", "is_overdue": false }
  ]

PUT /api/tasks/1
  Body: { "due_date": "2026-02-10", "priority": "urgent" }
  Response: 200 { "id": 1, "due_date": "2026-02-10", "priority": "urgent", ... }
```

---

## Scenario 6: Multiple Projects

### Description
Sarah gets a new client and needs to manage multiple projects simultaneously.

### Steps
1. Sarah creates a second project: "Beta Inc Logo Design"
2. She adds tasks to the new project
3. She views her project list showing both projects
4. Each project shows task count and progress
5. She can switch between projects easily

### Expected Results
- Multiple projects are supported
- Each project has isolated tasks and labels
- Project list shows summary stats for each
- Switching projects shows only that project's tasks

### API Calls
```
POST /api/projects
  Body: { "name": "Beta Inc Logo Design", "color": "#3B82F6" }
  Response: 201 { "id": 2, ... }

GET /api/projects
  Response: 200 [
    { "id": 1, "name": "Acme Corp Website", "task_count": 5, "completed_count": 2 },
    { "id": 2, "name": "Beta Inc Logo Design", "task_count": 3, "completed_count": 0 }
  ]
```

---

## Scenario 7: Project Archival

### Description
Sarah completes the Acme Corp project and wants to archive it to keep her project list clean while preserving the history.

### Steps
1. Sarah marks all remaining tasks as "done"
2. She clicks "Archive Project" on Acme Corp Website
3. The project disappears from her active project list
4. She can view archived projects by toggling a filter
5. Archived project data is still accessible for reference

### Expected Results
- Project is marked as archived
- Project doesn't appear in default project list
- Project still exists and can be viewed
- Cannot create new tasks in archived project

### API Calls
```
POST /api/projects/1/archive
  Response: 200 { "id": 1, "is_archived": true, ... }

GET /api/projects
  Response: 200 [{ "id": 2, "name": "Beta Inc Logo Design", ... }]

GET /api/projects?include_archived=true
  Response: 200 [
    { "id": 1, "name": "Acme Corp Website", "is_archived": true },
    { "id": 2, "name": "Beta Inc Logo Design", "is_archived": false }
  ]
```

---

## Scenario 8: Error Handling

### Description
Testing various error conditions to ensure the system handles invalid input gracefully.

### Test Cases

| Test | Input | Expected Response |
|------|-------|-------------------|
| Empty task title | `{ "title": "" }` | 400: Title is required |
| Invalid priority | `{ "priority": "super-high" }` | 400: Invalid priority value |
| Past due date | `{ "due_date": "2020-01-01" }` | 400: Due date must be today or future |
| Invalid color | `{ "color": "purple" }` | 400: Invalid hex color format |
| Duplicate username | Register with existing username | 409: Username already exists |
| Non-existent project | `GET /api/projects/999` | 404: Project not found |
| Unauthorized access | Missing auth token | 401: Authentication required |
| Access other user's project | User 2 accessing User 1's project | 403: Forbidden |

---

## Summary

These scenarios cover the complete user journey from registration through active project management to archival. They test:

1. **Authentication**: Registration, login, token-based auth
2. **CRUD Operations**: Create, read, update, delete for all entities
3. **Business Logic**: Status transitions, overdue detection, cascade operations
4. **Data Validation**: Input validation, error handling
5. **Permissions**: User-scoped data, owner-only operations
6. **Filtering/Querying**: Task filtering, dashboard aggregations

Use the attached BRD (`task_manager_brd.md`) with the Python App Factory to generate a complete implementation of this system.
