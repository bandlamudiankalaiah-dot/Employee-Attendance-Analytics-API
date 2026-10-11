export interface ProjectFile {
  name: string;
  path: string;
  language: string;
  description: string;
  category: "Code" | "Docs" | "Tests" | "Config";
}

export const PROJECT_FILES: ProjectFile[] = [
  {
    name: "app/main.py",
    path: "/app/main.py",
    language: "python",
    category: "Code",
    description: "Complete FastAPI backend with PyMongo, Pydantic v2, all 12 endpoints, IST timezone conversion, overnight shifts, decimal half-up rounding, and MongoDB aggregations."
  },
  {
    name: "openapi.yaml",
    path: "/openapi.yaml",
    language: "yaml",
    category: "Config",
    description: "Authoritative OpenAPI 3.1 contract specifying all endpoints, request bodies, query filters, and response schemas."
  },
  {
    name: "DATA_MODEL.md",
    path: "/DATA_MODEL.md",
    language: "markdown",
    category: "Docs",
    description: "MongoDB collections, BSON data types, compound indexes, and atomic concurrency mechanisms."
  },
  {
    name: "REVIEW.md",
    path: "/REVIEW.md",
    language: "markdown",
    category: "Docs",
    description: "Detailed code review cataloging 18 defects in starter implementations, reproductions, and production fixes."
  },
  {
    name: "DECISIONS.md",
    path: "/DECISIONS.md",
    language: "markdown",
    category: "Docs",
    description: "Concise, interview-ready answers to the 5 core architectural and indexing questions."
  },
  {
    name: "sample_seed.py",
    path: "/sample_seed.py",
    language: "python",
    category: "Code",
    description: "Realistic seed script with overnight shifts, boundary cases, mid-month joiners, and reproducible exact 100,000 records generation."
  },
  {
    name: "tests/test_api.py",
    path: "/tests/test_api.py",
    language: "python",
    category: "Tests",
    description: "Exhaustive pytest suite covering business rules R1-R5, boundary conditions, race conditions, impossible dates, and aggregations."
  },
  {
    name: "tests/conftest.py",
    path: "/tests/conftest.py",
    language: "python",
    category: "Tests",
    description: "Pytest fixtures and test database setup using MongoMock and FastAPI TestClient."
  },
  {
    name: "requirements.txt",
    path: "/requirements.txt",
    language: "text",
    category: "Config",
    description: "Production-locked dependencies for FastAPI, PyMongo, Pydantic v2, and email-validator."
  },
  {
    name: "README.md",
    path: "/README.md",
    language: "markdown",
    category: "Docs",
    description: "Comprehensive project documentation, Windows PowerShell instructions, endpoint guides, and architecture."
  }
];
