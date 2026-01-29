# Business Requirements Document (BRD)
# Task Management System - "TaskFlow"

## Document Information
- **Version**: 1.0
- **Date**: January 2026
- **Author**: Product Team

---

## 1. Executive Summary

TaskFlow is a lightweight task management application designed for small teams. The system allows users to create, organize, and track tasks with support for projects, labels, priorities, and due dates. The application consists of a web-based frontend, a FastAPI backend, and SQLite for data persistence.

---

## 2. Business Objectives

1. Provide a simple, intuitive task management solution
2. Enable team collaboration through shared projects
3. Support task organization with labels and priorities
4. Track task completion and productivity metrics

---

## 3. System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Frontend  │────▶│  FastAPI Server │────▶│  SQLite Database│
│   (HTML/JS)     │◀────│  (Python)       │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 4. Data Models

### 4.1 User
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY, AUTO | Unique identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | User email address |
| username | VARCHAR(50) | UNIQUE, NOT NULL | Display name |
| password_hash | VARCHAR(255) | NOT NULL | Bcrypt hashed password |
| created_at | DATETIME | NOT NULL | Account creation timestamp |
| is_active | BOOLEAN | DEFAULT TRUE | Account status |

### 4.2 Project
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY, AUTO | Unique identifier |
| name | VARCHAR(100) | NOT NULL | Project name |
| description | TEXT | NULLABLE | Project description |
| owner_id | INTEGER | FOREIGN KEY → User.id | Project owner |
| color | VARCHAR(7) | DEFAULT "#3B82F6" | Hex color code for UI |
| created_at | DATETIME | NOT NULL | Creation timestamp |
| is_archived | BOOLEAN | DEFAULT FALSE | Archive status |

### 4.3 Task
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY, AUTO | Unique identifier |
| title | VARCHAR(200) | NOT NULL | Task title (max 200 chars) |
| description | TEXT | NULLABLE | Detailed description |
| project_id | INTEGER | FOREIGN KEY → Project.id | Parent project |
| assignee_id | INTEGER | FOREIGN KEY → User.id, NULLABLE | Assigned user |
| priority | ENUM | "low", "medium", "high", "urgent" | Task priority |
| status | ENUM | "todo", "in_progress", "review", "done" | Task status |
| due_date | DATE | NULLABLE | Due date |
| created_at | DATETIME | NOT NULL | Creation timestamp |
| updated_at | DATETIME | NOT NULL | Last update timestamp |
| completed_at | DATETIME | NULLABLE | Completion timestamp |

### 4.4 Label
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY, AUTO | Unique identifier |
| name | VARCHAR(50) | NOT NULL | Label name |
| color | VARCHAR(7) | NOT NULL | Hex color code |
| project_id | INTEGER | FOREIGN KEY → Project.id | Parent project |

### 4.5 TaskLabel (Junction Table)
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| task_id | INTEGER | FOREIGN KEY → Task.id | Task reference |
| label_id | INTEGER | FOREIGN KEY → Label.id | Label reference |
| PRIMARY KEY | (task_id, label_id) | | Composite key |

---

## 5. API Endpoints

### 5.1 Authentication
| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/api/auth/register` | Register new user | `{email, username, password}` | `{id, email, username}` |
| POST | `/api/auth/login` | User login | `{email, password}` | `{access_token, token_type}` |
| GET | `/api/auth/me` | Get current user | - | `{id, email, username}` |

### 5.2 Projects
| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/api/projects` | List user's projects | - | `[{id, name, description, color, task_count}]` |
| POST | `/api/projects` | Create project | `{name, description?, color?}` | `{id, name, ...}` |
| GET | `/api/projects/{id}` | Get project details | - | `{id, name, description, tasks, labels}` |
| PUT | `/api/projects/{id}` | Update project | `{name?, description?, color?}` | `{id, name, ...}` |
| DELETE | `/api/projects/{id}` | Delete project | - | `204 No Content` |
| POST | `/api/projects/{id}/archive` | Archive project | - | `{id, is_archived: true}` |

### 5.3 Tasks
| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/api/projects/{project_id}/tasks` | List tasks in project | Query: `?status=&priority=&assignee_id=` | `[{id, title, status, priority, ...}]` |
| POST | `/api/projects/{project_id}/tasks` | Create task | `{title, description?, priority?, due_date?, assignee_id?}` | `{id, title, ...}` |
| GET | `/api/tasks/{id}` | Get task details | - | `{id, title, description, labels, ...}` |
| PUT | `/api/tasks/{id}` | Update task | `{title?, description?, status?, priority?, due_date?}` | `{id, title, ...}` |
| DELETE | `/api/tasks/{id}` | Delete task | - | `204 No Content` |
| POST | `/api/tasks/{id}/labels/{label_id}` | Add label to task | - | `{task_id, labels}` |
| DELETE | `/api/tasks/{id}/labels/{label_id}` | Remove label from task | - | `204 No Content` |

### 5.4 Labels
| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/api/projects/{project_id}/labels` | List project labels | - | `[{id, name, color}]` |
| POST | `/api/projects/{project_id}/labels` | Create label | `{name, color}` | `{id, name, color}` |
| PUT | `/api/labels/{id}` | Update label | `{name?, color?}` | `{id, name, color}` |
| DELETE | `/api/labels/{id}` | Delete label | - | `204 No Content` |

### 5.5 Dashboard/Stats
| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| GET | `/api/dashboard/stats` | Get user statistics | `{total_tasks, completed_today, overdue, by_priority, by_status}` |
| GET | `/api/dashboard/upcoming` | Get upcoming tasks | `[{id, title, due_date, project_name}]` (next 7 days) |

---

## 6. Business Rules

### 6.1 Task Rules
1. **Title Validation**: Task title must be 1-200 characters
2. **Default Priority**: New tasks default to "medium" priority
3. **Default Status**: New tasks default to "todo" status
4. **Completion Tracking**: When status changes to "done", set `completed_at` to current timestamp
5. **Overdue Detection**: Tasks with `due_date < today` and `status != "done"` are overdue

### 6.2 Project Rules
1. **Cascade Delete**: Deleting a project deletes all associated tasks and labels
2. **Archive Behavior**: Archived projects are hidden from default list but data is retained
3. **Owner Permissions**: Only project owner can delete or archive the project

### 6.3 Label Rules
1. **Color Format**: Must be valid hex color (e.g., "#FF5733")
2. **Unique Names**: Label names must be unique within a project
3. **Cascade Delete**: Deleting a label removes it from all tasks

---

## 7. Validation Rules

### 7.1 User Registration
- Email: Valid email format, max 255 characters
- Username: 3-50 characters, alphanumeric and underscores only
- Password: Minimum 8 characters, at least one letter and one number

### 7.2 Task Creation
- Title: Required, 1-200 characters
- Priority: Must be one of: "low", "medium", "high", "urgent"
- Status: Must be one of: "todo", "in_progress", "review", "done"
- Due Date: Must be today or future date (if provided)

### 7.3 Color Values
- Must match pattern: `^#[0-9A-Fa-f]{6}$`

---

## 8. Error Handling

### 8.1 Standard Error Response Format
```json
{
  "detail": "Error message description",
  "error_code": "VALIDATION_ERROR",
  "field": "email"
}
```

### 8.2 HTTP Status Codes
| Code | Usage |
|------|-------|
| 200 | Successful GET, PUT |
| 201 | Successful POST (created) |
| 204 | Successful DELETE |
| 400 | Validation error |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (not owner/assignee) |
| 404 | Resource not found |
| 409 | Conflict (duplicate email, username) |
| 500 | Internal server error |

---

## 9. Test Requirements

### 9.1 Unit Tests Required
1. User registration with valid/invalid data
2. User login with correct/incorrect credentials
3. CRUD operations for projects
4. CRUD operations for tasks
5. Task filtering by status, priority, assignee
6. Label management
7. Task-label association
8. Overdue task detection
9. Dashboard statistics calculation

### 9.2 Test Data
- Create at least 2 test users
- Create at least 2 projects per user
- Create at least 5 tasks per project with varying statuses/priorities
- Create at least 3 labels per project

---

## 10. Non-Functional Requirements

1. **Performance**: API responses should complete within 200ms for standard operations
2. **Database**: Use SQLite with WAL mode for concurrent access
3. **Security**: Passwords must be hashed using bcrypt
4. **Authentication**: Use JWT tokens with 24-hour expiration

---

## Appendix A: Sample Data

### Sample Project
```json
{
  "name": "Website Redesign",
  "description": "Q1 2026 website refresh project",
  "color": "#8B5CF6"
}
```

### Sample Task
```json
{
  "title": "Design new homepage mockup",
  "description": "Create Figma mockup for the new homepage design including hero section, features, and footer",
  "priority": "high",
  "status": "in_progress",
  "due_date": "2026-02-15"
}
```

### Sample Label
```json
{
  "name": "Design",
  "color": "#EC4899"
}
```
