// GENERATED FILE — DO NOT EDIT.
// Run `pnpm run api:docs` to regenerate; CI fails if this file is stale.
// Source of truth: src/lib/api/registry.generated.ts. See scripts/generate-api-docs.mts.

export const OPENAPI_DOCUMENT = {
  "openapi": "3.1.0",
  "info": {
    "title": "RVLT Flow Agent API",
    "version": "2.0.0",
    "description": "Agent-accessible REST API over the same Convex-native surface + gates a human operator faces in the UI (docs/designs/api-mcp-reimplementation.md). Generated from the operation registry — never hand-authored."
  },
  "servers": [
    {
      "url": "https://flow.rvlt.app"
    }
  ],
  "security": [
    {
      "bearerAuth": []
    }
  ],
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "An org API key (Settings → API keys)."
      }
    },
    "schemas": {
      "SuccessEnvelope": {
        "type": "object",
        "properties": {
          "data": {},
          "requestId": {
            "type": [
              "string",
              "null"
            ]
          },
          "replayed": {
            "type": "boolean"
          }
        }
      },
      "ErrorEnvelope": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": {
              "code": {
                "type": "string"
              },
              "category": {
                "type": "string"
              },
              "retryable": {
                "type": "boolean"
              },
              "message": {
                "type": "string"
              },
              "recovery": {
                "type": [
                  "object",
                  "null"
                ]
              },
              "requiredScope": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "requestId": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "details": {
                "type": [
                  "object",
                  "null"
                ]
              }
            }
          }
        }
      }
    }
  },
  "paths": {
    "/api/v1/whoami": {
      "get": {
        "operationId": "whoami",
        "summary": "Test your credentials — org, acting user, live permissions, scopes, limits.",
        "responses": {
          "200": {
            "description": "OK"
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/operations": {
      "get": {
        "operationId": "listOperations",
        "summary": "Paginated list of every operation this key can call.",
        "parameters": [
          {
            "name": "resource",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "kind",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "query",
                "mutation"
              ]
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK"
          }
        }
      }
    },
    "/api/v1/operations/{operation}": {
      "get": {
        "operationId": "getOperation",
        "summary": "One operation's schema, scope, and error codes.",
        "parameters": [
          {
            "name": "operation",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK"
          },
          "404": {
            "description": "Unknown or not agent-reachable."
          }
        }
      }
    },
    "/api/v1/ops/assetAccessoriesWrites.addBulkNative": {
      "post": {
        "operationId": "assetAccessoriesWrites.addBulkNative",
        "summary": "assetAccessoriesWrites.addBulkNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "allocationMode": {},
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "parentAssetId": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "allocationMode",
                      "bulkAssetId",
                      "parentAssetId",
                      "quantity"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetAccessoriesWrites.addSerializedNative": {
      "post": {
        "operationId": "assetAccessoriesWrites.addSerializedNative",
        "summary": "assetAccessoriesWrites.addSerializedNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "childAssetId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "parentAssetId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "childAssetId",
                      "parentAssetId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetAccessoriesWrites.removeBulkNative": {
      "post": {
        "operationId": "assetAccessoriesWrites.removeBulkNative",
        "summary": "assetAccessoriesWrites.removeBulkNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "bulkChildId": {
                        "type": "string"
                      },
                      "parentAssetId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "bulkChildId",
                      "parentAssetId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetAccessoriesWrites.removeSerializedNative": {
      "post": {
        "operationId": "assetAccessoriesWrites.removeSerializedNative",
        "summary": "assetAccessoriesWrites.removeSerializedNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "childAssetId": {
                        "type": "string"
                      },
                      "parentAssetId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "childAssetId",
                      "parentAssetId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetDetail.bundle": {
      "post": {
        "operationId": "assetDetail.bundle",
        "summary": "assetDetail.bundle (query)",
        "description": "Requires scope: asset:read.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "assetId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assets.getById": {
      "post": {
        "operationId": "assets.getById",
        "summary": "assets.getById (query)",
        "description": "Requires scope: asset:read.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assets.list": {
      "post": {
        "operationId": "assets.list",
        "summary": "assets.list (query)",
        "description": "Requires scope: asset:read.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assets.listByModel": {
      "post": {
        "operationId": "assets.listByModel",
        "summary": "assets.listByModel (query)",
        "description": "Requires scope: asset:read.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "modelId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "modelId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetWrites.archiveNative": {
      "post": {
        "operationId": "assetWrites.archiveNative",
        "summary": "assetWrites.archiveNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetWrites.bulkTagNative": {
      "post": {
        "operationId": "assetWrites.bulkTagNative",
        "summary": "assetWrites.bulkTagNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      },
                      "tags": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "ids",
                      "tags"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetWrites.bulkUpdateNative": {
      "post": {
        "operationId": "assetWrites.bulkUpdateNative",
        "summary": "assetWrites.bulkUpdateNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clear": {
                        "type": "array"
                      },
                      "ids": {
                        "type": "array"
                      },
                      "set": {
                        "type": "object"
                      }
                    },
                    "required": [
                      "clear",
                      "ids",
                      "set"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetWrites.createManyNative": {
      "post": {
        "operationId": "assetWrites.createManyNative",
        "summary": "assetWrites.createManyNative (mutation)",
        "description": "Requires scope: asset:create.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assets": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "assets"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetWrites.createNative": {
      "post": {
        "operationId": "assetWrites.createNative",
        "summary": "assetWrites.createNative (mutation)",
        "description": "Requires scope: asset:create.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetTag": {
                        "type": "string"
                      },
                      "barcode": {
                        "type": "string"
                      },
                      "condition": {},
                      "createdAt": {
                        "type": "number"
                      },
                      "customFieldValues": {},
                      "customName": {
                        "type": "string"
                      },
                      "images": {
                        "type": "array"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "kitId": {
                        "type": "string"
                      },
                      "lastTestAndTagDate": {
                        "type": "number"
                      },
                      "locationId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "nextTestAndTagDate": {
                        "type": "number"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "parentAssetId": {
                        "type": "string"
                      },
                      "purchaseDate": {
                        "type": "number"
                      },
                      "purchaseOrderNumber": {
                        "type": "string"
                      },
                      "purchasePrice": {
                        "type": "number"
                      },
                      "purchaseSupplier": {
                        "type": "string"
                      },
                      "qrCode": {
                        "type": "string"
                      },
                      "serialNumber": {
                        "type": "string"
                      },
                      "status": {},
                      "supplierId": {
                        "type": "string"
                      },
                      "supplierOrderId": {
                        "type": "string"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "updatedAt": {
                        "type": "number"
                      },
                      "warrantyExpiry": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "assetTag",
                      "modelId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetWrites.deleteNative": {
      "post": {
        "operationId": "assetWrites.deleteNative",
        "summary": "assetWrites.deleteNative (mutation)",
        "description": "Requires scope: asset:delete.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetWrites.updateNative": {
      "post": {
        "operationId": "assetWrites.updateNative",
        "summary": "assetWrites.updateNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clear": {
                        "type": "array"
                      },
                      "id": {
                        "type": "string"
                      },
                      "set": {
                        "type": "object"
                      }
                    },
                    "required": [
                      "clear",
                      "id",
                      "set"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/assetWrites.updateNotesNative": {
      "post": {
        "operationId": "assetWrites.updateNotesNative",
        "summary": "assetWrites.updateNotesNative (mutation)",
        "description": "Requires scope: asset:update.",
        "tags": [
          "asset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "notes": {}
                    },
                    "required": [
                      "id",
                      "notes"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/availability.assetBookings": {
      "post": {
        "operationId": "availability.assetBookings",
        "summary": "availability.assetBookings (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "endMs": {
                        "type": "number"
                      },
                      "startMs": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "assetId",
                      "endMs",
                      "startMs"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/availability.calendarData": {
      "post": {
        "operationId": "availability.calendarData",
        "summary": "availability.calendarData (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "endMs": {
                        "type": "number"
                      },
                      "startMs": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "endMs",
                      "startMs"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/availability.kitBookings": {
      "post": {
        "operationId": "availability.kitBookings",
        "summary": "availability.kitBookings (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "endMs": {
                        "type": "number"
                      },
                      "kitId": {
                        "type": "string"
                      },
                      "startMs": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "endMs",
                      "kitId",
                      "startMs"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/availability.modelBookings": {
      "post": {
        "operationId": "availability.modelBookings",
        "summary": "availability.modelBookings (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "endMs": {
                        "type": "number"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "startMs": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "endMs",
                      "modelId",
                      "startMs"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/bulkAssets.getById": {
      "post": {
        "operationId": "bulkAssets.getById",
        "summary": "bulkAssets.getById (query)",
        "description": "Requires scope: bulkAsset:read.",
        "tags": [
          "bulkAsset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/bulkAssets.list": {
      "post": {
        "operationId": "bulkAssets.list",
        "summary": "bulkAssets.list (query)",
        "description": "Requires scope: bulkAsset:read.",
        "tags": [
          "bulkAsset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/bulkAssetsWrites.archiveNative": {
      "post": {
        "operationId": "bulkAssetsWrites.archiveNative",
        "summary": "bulkAssetsWrites.archiveNative (mutation)",
        "description": "Requires scope: bulkAsset:update.",
        "tags": [
          "bulkAsset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/bulkAssetsWrites.createNative": {
      "post": {
        "operationId": "bulkAssetsWrites.createNative",
        "summary": "bulkAssetsWrites.createNative (mutation)",
        "description": "Requires scope: bulkAsset:create.",
        "tags": [
          "bulkAsset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetTag": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "locationId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "purchasePricePerUnit": {
                        "type": "number"
                      },
                      "status": {},
                      "tags": {
                        "type": "array"
                      },
                      "totalQuantity": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "assetTag",
                      "modelId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/bulkAssetsWrites.deleteNative": {
      "post": {
        "operationId": "bulkAssetsWrites.deleteNative",
        "summary": "bulkAssetsWrites.deleteNative (mutation)",
        "description": "Requires scope: bulkAsset:delete.",
        "tags": [
          "bulkAsset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/bulkAssetsWrites.updateNative": {
      "post": {
        "operationId": "bulkAssetsWrites.updateNative",
        "summary": "bulkAssetsWrites.updateNative (mutation)",
        "description": "Requires scope: bulkAsset:update.",
        "tags": [
          "bulkAsset"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetTag": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "locationId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "purchasePricePerUnit": {
                        "type": "number"
                      },
                      "status": {},
                      "tags": {
                        "type": "array"
                      },
                      "totalQuantity": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "assetTag",
                      "id",
                      "modelId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categories.getById": {
      "post": {
        "operationId": "categories.getById",
        "summary": "categories.getById (query)",
        "description": "Requires scope: model:read.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categories.list": {
      "post": {
        "operationId": "categories.list",
        "summary": "categories.list (query)",
        "description": "Requires scope: model:read.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categoriesWrites.createNative": {
      "post": {
        "operationId": "categoriesWrites.createNative",
        "summary": "categoriesWrites.createNative (mutation)",
        "description": "Requires scope: model:create.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string"
                      },
                      "icon": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "parentId": {
                        "type": "string"
                      },
                      "sortOrder": {
                        "type": "number"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "xeroAccountCode": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categoriesWrites.removeNative": {
      "post": {
        "operationId": "categoriesWrites.removeNative",
        "summary": "categoriesWrites.removeNative (mutation)",
        "description": "Requires scope: model:delete.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categoriesWrites.updateNative": {
      "post": {
        "operationId": "categoriesWrites.updateNative",
        "summary": "categoriesWrites.updateNative (mutation)",
        "description": "Requires scope: model:update.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string"
                      },
                      "icon": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "parentId": {
                        "type": "string"
                      },
                      "sortOrder": {
                        "type": "number"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "xeroAccountCode": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categorySlotsWrites.createCategoryAndPlaceGroup": {
      "post": {
        "operationId": "categorySlotsWrites.createCategoryAndPlaceGroup",
        "summary": "categorySlotsWrites.createCategoryAndPlaceGroup (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "categoryId": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "slot": {
                        "type": "object"
                      },
                      "slotId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "categoryId",
                      "name",
                      "projectId",
                      "slot",
                      "slotId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categorySlotsWrites.moveProjectGroupToCategory": {
      "post": {
        "operationId": "categorySlotsWrites.moveProjectGroupToCategory",
        "summary": "categorySlotsWrites.moveProjectGroupToCategory (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "categoryId": {},
                      "groupId": {
                        "type": "string"
                      },
                      "slotId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "categoryId",
                      "groupId",
                      "slotId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categorySlotsWrites.moveSubHireGroupToCategory": {
      "post": {
        "operationId": "categorySlotsWrites.moveSubHireGroupToCategory",
        "summary": "categorySlotsWrites.moveSubHireGroupToCategory (mutation)",
        "description": "Requires scope: project:manage_line_items or subHire:update.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "categoryId": {},
                      "groupId": {
                        "type": "string"
                      },
                      "slotId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "categoryId",
                      "groupId",
                      "slotId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/categorySlotsWrites.reorderMixedGroupsInCategory": {
      "post": {
        "operationId": "categorySlotsWrites.reorderMixedGroupsInCategory",
        "summary": "categorySlotsWrites.reorderMixedGroupsInCategory (mutation)",
        "description": "Requires scope: project:manage_line_items or subHire:update.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "categoryId": {
                        "type": "string"
                      },
                      "items": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "categoryId",
                      "items"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.addCheckItemToKitNative": {
      "post": {
        "operationId": "checkItemsWrites.addCheckItemToKitNative",
        "summary": "checkItemsWrites.addCheckItemToKitNative (mutation)",
        "description": "Requires scope: checkItem:update.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "checkItemId": {
                        "type": "string"
                      },
                      "kitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "checkItemId",
                      "kitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.addCheckItemToModelNative": {
      "post": {
        "operationId": "checkItemsWrites.addCheckItemToModelNative",
        "summary": "checkItemsWrites.addCheckItemToModelNative (mutation)",
        "description": "Requires scope: checkItem:update.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "checkItemId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "checkItemId",
                      "modelId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.bulkAddCheckItemsToModelsNative": {
      "post": {
        "operationId": "checkItemsWrites.bulkAddCheckItemsToModelsNative",
        "summary": "checkItemsWrites.bulkAddCheckItemsToModelsNative (mutation)",
        "description": "Requires scope: checkItem:update.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "checkItemIds": {
                        "type": "array"
                      },
                      "modelIds": {
                        "type": "array"
                      },
                      "rowIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "checkItemIds",
                      "modelIds",
                      "rowIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.createCheckItemNative": {
      "post": {
        "operationId": "checkItemsWrites.createCheckItemNative",
        "summary": "checkItemsWrites.createCheckItemNative (mutation)",
        "description": "Requires scope: checkItem:create.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "category": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "dropdownOptions": {},
                      "label": {
                        "type": "string"
                      },
                      "measurementMax": {
                        "type": "number"
                      },
                      "measurementMin": {
                        "type": "number"
                      },
                      "measurementUnit": {
                        "type": "string"
                      },
                      "type": {}
                    },
                    "required": [
                      "label"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.deleteCheckItemNative": {
      "post": {
        "operationId": "checkItemsWrites.deleteCheckItemNative",
        "summary": "checkItemsWrites.deleteCheckItemNative (mutation)",
        "description": "Requires scope: checkItem:delete.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.removeCheckItemFromKitNative": {
      "post": {
        "operationId": "checkItemsWrites.removeCheckItemFromKitNative",
        "summary": "checkItemsWrites.removeCheckItemFromKitNative (mutation)",
        "description": "Requires scope: checkItem:update.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "checkItemId": {
                        "type": "string"
                      },
                      "kitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "checkItemId",
                      "kitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.removeCheckItemFromModelNative": {
      "post": {
        "operationId": "checkItemsWrites.removeCheckItemFromModelNative",
        "summary": "checkItemsWrites.removeCheckItemFromModelNative (mutation)",
        "description": "Requires scope: checkItem:update.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "checkItemId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "checkItemId",
                      "modelId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.reorderKitCheckItemsNative": {
      "post": {
        "operationId": "checkItemsWrites.reorderKitCheckItemsNative",
        "summary": "checkItemsWrites.reorderKitCheckItemsNative (mutation)",
        "description": "Requires scope: checkItem:update.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      },
                      "orderedCheckItemIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "kitId",
                      "orderedCheckItemIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.reorderModelCheckItemsNative": {
      "post": {
        "operationId": "checkItemsWrites.reorderModelCheckItemsNative",
        "summary": "checkItemsWrites.reorderModelCheckItemsNative (mutation)",
        "description": "Requires scope: checkItem:update.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "modelId": {
                        "type": "string"
                      },
                      "orderedCheckItemIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "modelId",
                      "orderedCheckItemIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkItemsWrites.updateCheckItemNative": {
      "post": {
        "operationId": "checkItemsWrites.updateCheckItemNative",
        "summary": "checkItemsWrites.updateCheckItemNative (mutation)",
        "description": "Requires scope: checkItem:update.",
        "tags": [
          "checkItem"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "category": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "dropdownOptions": {},
                      "id": {
                        "type": "string"
                      },
                      "label": {
                        "type": "string"
                      },
                      "measurementMax": {
                        "type": "number"
                      },
                      "measurementMin": {
                        "type": "number"
                      },
                      "measurementUnit": {
                        "type": "string"
                      },
                      "type": {}
                    },
                    "required": [
                      "id",
                      "label"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkRecordWrites.completeCheckAndDeprep": {
      "post": {
        "operationId": "checkRecordWrites.completeCheckAndDeprep",
        "summary": "checkRecordWrites.completeCheckAndDeprep (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "checks": {
                        "type": "array"
                      },
                      "lineItemId": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "checks",
                      "lineItemId",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkRecordWrites.completeCheckAndFlag": {
      "post": {
        "operationId": "checkRecordWrites.completeCheckAndFlag",
        "summary": "checkRecordWrites.completeCheckAndFlag (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "checks": {
                        "type": "array"
                      },
                      "flagType": {},
                      "incidentPlan": {
                        "type": "array"
                      },
                      "lineItemId": {
                        "type": "string"
                      },
                      "maintenancePlan": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "checks",
                      "flagType",
                      "incidentPlan",
                      "lineItemId",
                      "maintenancePlan",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkRecordWrites.completeCheckAndPack": {
      "post": {
        "operationId": "checkRecordWrites.completeCheckAndPack",
        "summary": "checkRecordWrites.completeCheckAndPack (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "checks": {
                        "type": "array"
                      },
                      "incidentPlan": {
                        "type": "array"
                      },
                      "includeAccessoryIds": {
                        "type": "array"
                      },
                      "lineItemId": {
                        "type": "string"
                      },
                      "maintenancePlan": {
                        "type": "array"
                      },
                      "prepContainer": {},
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "checks",
                      "incidentPlan",
                      "lineItemId",
                      "maintenancePlan",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkRecordWrites.completeCheckAndStore": {
      "post": {
        "operationId": "checkRecordWrites.completeCheckAndStore",
        "summary": "checkRecordWrites.completeCheckAndStore (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "checks": {
                        "type": "array"
                      },
                      "condition": {},
                      "incidentPlan": {
                        "type": "array"
                      },
                      "lineItemId": {
                        "type": "string"
                      },
                      "maintenancePlan": {
                        "type": "array"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "checks",
                      "condition",
                      "incidentPlan",
                      "lineItemId",
                      "maintenancePlan",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/checkRecordWrites.saveAdHocCheck": {
      "post": {
        "operationId": "checkRecordWrites.saveAdHocCheck",
        "summary": "checkRecordWrites.saveAdHocCheck (mutation)",
        "description": "Requires scope: warehouse:scan.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "checks": {
                        "type": "array"
                      },
                      "incidentPlan": {
                        "type": "array"
                      },
                      "maintenancePlan": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "assetId",
                      "checks",
                      "incidentPlan",
                      "maintenancePlan"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientContactWrites.addNative": {
      "post": {
        "operationId": "clientContactWrites.addNative",
        "summary": "clientContactWrites.addNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientId": {
                        "type": "string"
                      },
                      "email": {
                        "type": "string"
                      },
                      "isPrimary": {
                        "type": "boolean"
                      },
                      "name": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "phone": {
                        "type": "string"
                      },
                      "role": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientContactWrites.removeNative": {
      "post": {
        "operationId": "clientContactWrites.removeNative",
        "summary": "clientContactWrites.removeNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientId": {
                        "type": "string"
                      },
                      "contactId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientId",
                      "contactId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientContactWrites.reorderNative": {
      "post": {
        "operationId": "clientContactWrites.reorderNative",
        "summary": "clientContactWrites.reorderNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientId": {
                        "type": "string"
                      },
                      "orderedIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "clientId",
                      "orderedIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientContactWrites.setPrimaryNative": {
      "post": {
        "operationId": "clientContactWrites.setPrimaryNative",
        "summary": "clientContactWrites.setPrimaryNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientId": {
                        "type": "string"
                      },
                      "contactId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientId",
                      "contactId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientContactWrites.updateNative": {
      "post": {
        "operationId": "clientContactWrites.updateNative",
        "summary": "clientContactWrites.updateNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientId": {
                        "type": "string"
                      },
                      "contactId": {
                        "type": "string"
                      },
                      "email": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "phone": {
                        "type": "string"
                      },
                      "role": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientId",
                      "contactId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clients.detail": {
      "post": {
        "operationId": "clients.detail",
        "summary": "clients.detail (query)",
        "description": "Requires scope: client:read.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clients.getById": {
      "post": {
        "operationId": "clients.getById",
        "summary": "clients.getById (query)",
        "description": "Requires scope: client:read.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clients.list": {
      "post": {
        "operationId": "clients.list",
        "summary": "clients.list (query)",
        "description": "Requires scope: client:read.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientWrites.archiveManyNative": {
      "post": {
        "operationId": "clientWrites.archiveManyNative",
        "summary": "clientWrites.archiveManyNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "items": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "items"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientWrites.archiveNative": {
      "post": {
        "operationId": "clientWrites.archiveNative",
        "summary": "clientWrites.archiveNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientWrites.createNative": {
      "post": {
        "operationId": "clientWrites.createNative",
        "summary": "clientWrites.createNative (mutation)",
        "description": "Requires scope: client:create.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "billingAddress": {
                        "type": "string"
                      },
                      "billingLatitude": {
                        "type": "number"
                      },
                      "billingLongitude": {
                        "type": "number"
                      },
                      "contactEmail": {
                        "type": "string"
                      },
                      "contactName": {
                        "type": "string"
                      },
                      "contactPhone": {
                        "type": "string"
                      },
                      "createdAt": {
                        "type": "number"
                      },
                      "defaultDiscount": {
                        "type": "number"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "name": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "paymentProfile": {},
                      "paymentTerms": {
                        "type": "string"
                      },
                      "profileDepositPercent": {
                        "type": "number"
                      },
                      "shippingAddress": {
                        "type": "string"
                      },
                      "shippingLatitude": {
                        "type": "number"
                      },
                      "shippingLongitude": {
                        "type": "number"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "taxId": {
                        "type": "string"
                      },
                      "type": {},
                      "updatedAt": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientWrites.updateNative": {
      "post": {
        "operationId": "clientWrites.updateNative",
        "summary": "clientWrites.updateNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "patch": {
                        "type": "object"
                      }
                    },
                    "required": [
                      "id",
                      "patch"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/clientWrites.updateNotesNative": {
      "post": {
        "operationId": "clientWrites.updateNotesNative",
        "summary": "clientWrites.updateNotesNative (mutation)",
        "description": "Requires scope: client:update.",
        "tags": [
          "client"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "notes": {}
                    },
                    "required": [
                      "id",
                      "notes"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.acquireLock": {
      "post": {
        "operationId": "collaboration.acquireLock",
        "summary": "collaboration.acquireLock (mutation)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientSessionId": {
                        "type": "string"
                      },
                      "entityId": {
                        "type": "string"
                      },
                      "entityType": {
                        "type": "string"
                      },
                      "ownerColor": {
                        "type": "string"
                      },
                      "ownerName": {
                        "type": "string"
                      },
                      "ownerUserId": {
                        "type": "string"
                      },
                      "targetId": {
                        "type": "string"
                      },
                      "targetType": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientSessionId",
                      "entityId",
                      "entityType",
                      "ownerColor",
                      "ownerName",
                      "ownerUserId",
                      "targetId",
                      "targetType"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.addComment": {
      "post": {
        "operationId": "collaboration.addComment",
        "summary": "collaboration.addComment (mutation)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "authorColor": {
                        "type": "string"
                      },
                      "authorId": {
                        "type": "string"
                      },
                      "authorName": {
                        "type": "string"
                      },
                      "body": {
                        "type": "string"
                      },
                      "mentionUserIds": {
                        "type": "array"
                      },
                      "threadId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "authorId",
                      "authorName",
                      "body",
                      "threadId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.clearPresence": {
      "post": {
        "operationId": "collaboration.clearPresence",
        "summary": "collaboration.clearPresence (mutation)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "entityId": {
                        "type": "string"
                      },
                      "entityType": {
                        "type": "string"
                      },
                      "userId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "entityId",
                      "entityType",
                      "userId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.createThread": {
      "post": {
        "operationId": "collaboration.createThread",
        "summary": "collaboration.createThread (mutation)",
        "description": "Requires scope: project:manage_line_items or project:read.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "authorColor": {
                        "type": "string"
                      },
                      "createdBy": {
                        "type": "string"
                      },
                      "createdByName": {
                        "type": "string"
                      },
                      "entityId": {
                        "type": "string"
                      },
                      "entityType": {
                        "type": "string"
                      },
                      "firstComment": {
                        "type": "string"
                      },
                      "isBlocking": {
                        "type": "boolean"
                      },
                      "mentionUserIds": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "targetId": {
                        "type": "string"
                      },
                      "targetType": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "createdBy",
                      "createdByName",
                      "entityId",
                      "entityType",
                      "firstComment"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.heartbeatLock": {
      "post": {
        "operationId": "collaboration.heartbeatLock",
        "summary": "collaboration.heartbeatLock (mutation)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientSessionId": {
                        "type": "string"
                      },
                      "lockId": {
                        "type": "string"
                      },
                      "ownerUserId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientSessionId",
                      "lockId",
                      "ownerUserId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.heartbeatPresence": {
      "post": {
        "operationId": "collaboration.heartbeatPresence",
        "summary": "collaboration.heartbeatPresence (mutation)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "activeTargetId": {
                        "type": "string"
                      },
                      "activeTargetType": {
                        "type": "string"
                      },
                      "avatarUrl": {
                        "type": "string"
                      },
                      "entityId": {
                        "type": "string"
                      },
                      "entityType": {
                        "type": "string"
                      },
                      "mode": {},
                      "section": {
                        "type": "string"
                      },
                      "userColor": {
                        "type": "string"
                      },
                      "userId": {
                        "type": "string"
                      },
                      "userName": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "entityId",
                      "entityType",
                      "mode",
                      "userColor",
                      "userId",
                      "userName"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.releaseLock": {
      "post": {
        "operationId": "collaboration.releaseLock",
        "summary": "collaboration.releaseLock (mutation)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientSessionId": {
                        "type": "string"
                      },
                      "lockId": {
                        "type": "string"
                      },
                      "ownerUserId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientSessionId",
                      "lockId",
                      "ownerUserId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.reopenThread": {
      "post": {
        "operationId": "collaboration.reopenThread",
        "summary": "collaboration.reopenThread (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "actorColor": {
                        "type": "string"
                      },
                      "actorName": {
                        "type": "string"
                      },
                      "actorUserId": {
                        "type": "string"
                      },
                      "threadId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "threadId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.resolveThread": {
      "post": {
        "operationId": "collaboration.resolveThread",
        "summary": "collaboration.resolveThread (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "actorColor": {
                        "type": "string"
                      },
                      "actorName": {
                        "type": "string"
                      },
                      "resolvedBy": {
                        "type": "string"
                      },
                      "threadId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "resolvedBy",
                      "threadId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.setReviewMarker": {
      "post": {
        "operationId": "collaboration.setReviewMarker",
        "summary": "collaboration.setReviewMarker (mutation)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "actorColor": {
                        "type": "string"
                      },
                      "createdBy": {
                        "type": "string"
                      },
                      "createdByName": {
                        "type": "string"
                      },
                      "entityId": {
                        "type": "string"
                      },
                      "entityType": {
                        "type": "string"
                      },
                      "note": {
                        "type": "string"
                      },
                      "reason": {
                        "type": "string"
                      },
                      "status": {},
                      "targetId": {
                        "type": "string"
                      },
                      "targetType": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "createdBy",
                      "createdByName",
                      "entityId",
                      "entityType",
                      "status",
                      "targetId",
                      "targetType"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.setThreadBlocking": {
      "post": {
        "operationId": "collaboration.setThreadBlocking",
        "summary": "collaboration.setThreadBlocking (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "actorColor": {
                        "type": "string"
                      },
                      "actorName": {
                        "type": "string"
                      },
                      "actorUserId": {
                        "type": "string"
                      },
                      "isBlocking": {
                        "type": "boolean"
                      },
                      "threadId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "isBlocking",
                      "threadId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/collaboration.takeoverLock": {
      "post": {
        "operationId": "collaboration.takeoverLock",
        "summary": "collaboration.takeoverLock (mutation)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientSessionId": {
                        "type": "string"
                      },
                      "entityId": {
                        "type": "string"
                      },
                      "entityType": {
                        "type": "string"
                      },
                      "ownerColor": {
                        "type": "string"
                      },
                      "ownerName": {
                        "type": "string"
                      },
                      "ownerUserId": {
                        "type": "string"
                      },
                      "targetId": {
                        "type": "string"
                      },
                      "targetType": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientSessionId",
                      "entityId",
                      "entityType",
                      "ownerColor",
                      "ownerName",
                      "ownerUserId",
                      "targetId",
                      "targetType"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crew.memberDetail": {
      "post": {
        "operationId": "crew.memberDetail",
        "summary": "crew.memberDetail (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crew.memberExtras": {
      "post": {
        "operationId": "crew.memberExtras",
        "summary": "crew.memberExtras (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crew.orgUsersForCrewLink": {
      "post": {
        "operationId": "crew.orgUsersForCrewLink",
        "summary": "crew.orgUsersForCrewLink (query)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignments.getById": {
      "post": {
        "operationId": "crewAssignments.getById",
        "summary": "crewAssignments.getById (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignments.list": {
      "post": {
        "operationId": "crewAssignments.list",
        "summary": "crewAssignments.list (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignments.listByProject": {
      "post": {
        "operationId": "crewAssignments.listByProject",
        "summary": "crewAssignments.listByProject (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignments.projectCrew": {
      "post": {
        "operationId": "crewAssignments.projectCrew",
        "summary": "crewAssignments.projectCrew (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignmentsWrites.bulkDeleteNative": {
      "post": {
        "operationId": "crewAssignmentsWrites.bulkDeleteNative",
        "summary": "crewAssignmentsWrites.bulkDeleteNative (mutation)",
        "description": "Requires scope: crew:delete.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "ids"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignmentsWrites.bulkStatusNative": {
      "post": {
        "operationId": "crewAssignmentsWrites.bulkStatusNative",
        "summary": "crewAssignmentsWrites.bulkStatusNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      },
                      "status": {}
                    },
                    "required": [
                      "ids",
                      "status"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignmentsWrites.createNative": {
      "post": {
        "operationId": "crewAssignmentsWrites.createNative",
        "summary": "crewAssignmentsWrites.createNative (mutation)",
        "description": "Requires scope: crew:create.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "crewMemberId": {
                        "type": "string"
                      },
                      "crewRoleId": {
                        "type": "string"
                      },
                      "endDate": {
                        "type": "number"
                      },
                      "endTime": {
                        "type": "string"
                      },
                      "estimatedHours": {
                        "type": "number"
                      },
                      "generateShifts": {
                        "type": "boolean"
                      },
                      "internalNotes": {
                        "type": "string"
                      },
                      "isProjectManager": {
                        "type": "boolean"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "phase": {},
                      "projectId": {
                        "type": "string"
                      },
                      "rateOverride": {
                        "type": "number"
                      },
                      "rateType": {},
                      "serviceId": {
                        "type": "string"
                      },
                      "startDate": {
                        "type": "number"
                      },
                      "startTime": {
                        "type": "string"
                      },
                      "status": {}
                    },
                    "required": [
                      "crewMemberId",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignmentsWrites.deleteNative": {
      "post": {
        "operationId": "crewAssignmentsWrites.deleteNative",
        "summary": "crewAssignmentsWrites.deleteNative (mutation)",
        "description": "Requires scope: crew:delete.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignmentsWrites.generateShiftsNative": {
      "post": {
        "operationId": "crewAssignmentsWrites.generateShiftsNative",
        "summary": "crewAssignmentsWrites.generateShiftsNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assignmentId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "assignmentId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignmentsWrites.updateNative": {
      "post": {
        "operationId": "crewAssignmentsWrites.updateNative",
        "summary": "crewAssignmentsWrites.updateNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "crewMemberId": {
                        "type": "string"
                      },
                      "crewRoleId": {
                        "type": "string"
                      },
                      "endDate": {
                        "type": "number"
                      },
                      "endTime": {
                        "type": "string"
                      },
                      "estimatedHours": {
                        "type": "number"
                      },
                      "id": {
                        "type": "string"
                      },
                      "internalNotes": {
                        "type": "string"
                      },
                      "isProjectManager": {
                        "type": "boolean"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "phase": {},
                      "rateOverride": {
                        "type": "number"
                      },
                      "rateType": {},
                      "serviceId": {
                        "type": "string"
                      },
                      "startDate": {
                        "type": "number"
                      },
                      "startTime": {
                        "type": "string"
                      },
                      "status": {}
                    },
                    "required": [
                      "crewMemberId",
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAssignmentsWrites.updateStatusNative": {
      "post": {
        "operationId": "crewAssignmentsWrites.updateStatusNative",
        "summary": "crewAssignmentsWrites.updateStatusNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "status": {}
                    },
                    "required": [
                      "id",
                      "status"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAvailability.conflicts": {
      "post": {
        "operationId": "crewAvailability.conflicts",
        "summary": "crewAvailability.conflicts (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "crewMemberId": {
                        "type": "string"
                      },
                      "endMs": {
                        "type": "number"
                      },
                      "excludeAssignmentId": {
                        "type": "string"
                      },
                      "startMs": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "crewMemberId",
                      "endMs",
                      "startMs"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAvailability.memberAvailability": {
      "post": {
        "operationId": "crewAvailability.memberAvailability",
        "summary": "crewAvailability.memberAvailability (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "crewMemberId": {
                        "type": "string"
                      },
                      "endMs": {
                        "type": "number"
                      },
                      "startMs": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "crewMemberId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAvailability.plannerData": {
      "post": {
        "operationId": "crewAvailability.plannerData",
        "summary": "crewAvailability.plannerData (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "endMs": {
                        "type": "number"
                      },
                      "startMs": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "endMs",
                      "startMs"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAvailabilityWrites.addNative": {
      "post": {
        "operationId": "crewAvailabilityWrites.addNative",
        "summary": "crewAvailabilityWrites.addNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "crewMemberId": {
                        "type": "string"
                      },
                      "endDate": {
                        "type": "number"
                      },
                      "endTime": {
                        "type": "string"
                      },
                      "isAllDay": {
                        "type": "boolean"
                      },
                      "reason": {
                        "type": "string"
                      },
                      "startDate": {
                        "type": "number"
                      },
                      "startTime": {
                        "type": "string"
                      },
                      "type": {}
                    },
                    "required": [
                      "crewMemberId",
                      "endDate",
                      "isAllDay",
                      "startDate",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewAvailabilityWrites.removeNative": {
      "post": {
        "operationId": "crewAvailabilityWrites.removeNative",
        "summary": "crewAvailabilityWrites.removeNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewMembers.getById": {
      "post": {
        "operationId": "crewMembers.getById",
        "summary": "crewMembers.getById (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewMembers.list": {
      "post": {
        "operationId": "crewMembers.list",
        "summary": "crewMembers.list (query)",
        "description": "Requires scope: crew:read.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewRolesWrites.archiveNative": {
      "post": {
        "operationId": "crewRolesWrites.archiveNative",
        "summary": "crewRolesWrites.archiveNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "id",
                      "isActive"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewRolesWrites.createNative": {
      "post": {
        "operationId": "crewRolesWrites.createNative",
        "summary": "crewRolesWrites.createNative (mutation)",
        "description": "Requires scope: crew:create.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "chargeRate": {
                        "type": "number"
                      },
                      "color": {
                        "type": "string"
                      },
                      "defaultRate": {
                        "type": "number"
                      },
                      "department": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "name": {
                        "type": "string"
                      },
                      "rateType": {},
                      "sortOrder": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewRolesWrites.updateNative": {
      "post": {
        "operationId": "crewRolesWrites.updateNative",
        "summary": "crewRolesWrites.updateNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "chargeRate": {
                        "type": "number"
                      },
                      "color": {
                        "type": "string"
                      },
                      "defaultRate": {
                        "type": "number"
                      },
                      "department": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "rateType": {},
                      "sortOrder": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "id",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewTimeEntriesWrites.approveNative": {
      "post": {
        "operationId": "crewTimeEntriesWrites.approveNative",
        "summary": "crewTimeEntriesWrites.approveNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "ids"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewTimeEntriesWrites.createManyNative": {
      "post": {
        "operationId": "crewTimeEntriesWrites.createManyNative",
        "summary": "crewTimeEntriesWrites.createManyNative (mutation)",
        "description": "Requires scope: crew:create.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "entries": {
                        "type": "array"
                      },
                      "shared": {
                        "type": "object"
                      }
                    },
                    "required": [
                      "entries",
                      "shared"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewTimeEntriesWrites.createNative": {
      "post": {
        "operationId": "crewTimeEntriesWrites.createNative",
        "summary": "crewTimeEntriesWrites.createNative (mutation)",
        "description": "Requires scope: crew:create.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assignmentId": {
                        "type": "string"
                      },
                      "breakMinutes": {
                        "type": "number"
                      },
                      "crewMemberId": {
                        "type": "string"
                      },
                      "date": {
                        "type": "number"
                      },
                      "description": {
                        "type": "string"
                      },
                      "endTime": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "startTime": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "crewMemberId",
                      "date",
                      "endTime",
                      "startTime"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewTimeEntriesWrites.deleteNative": {
      "post": {
        "operationId": "crewTimeEntriesWrites.deleteNative",
        "summary": "crewTimeEntriesWrites.deleteNative (mutation)",
        "description": "Requires scope: crew:delete.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewTimeEntriesWrites.disputeNative": {
      "post": {
        "operationId": "crewTimeEntriesWrites.disputeNative",
        "summary": "crewTimeEntriesWrites.disputeNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "reason": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewTimeEntriesWrites.submitNative": {
      "post": {
        "operationId": "crewTimeEntriesWrites.submitNative",
        "summary": "crewTimeEntriesWrites.submitNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "ids"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewTimeEntriesWrites.updateNative": {
      "post": {
        "operationId": "crewTimeEntriesWrites.updateNative",
        "summary": "crewTimeEntriesWrites.updateNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assignmentId": {
                        "type": "string"
                      },
                      "breakMinutes": {
                        "type": "number"
                      },
                      "crewMemberId": {
                        "type": "string"
                      },
                      "date": {
                        "type": "number"
                      },
                      "description": {
                        "type": "string"
                      },
                      "endTime": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "startTime": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "crewMemberId",
                      "date",
                      "endTime",
                      "id",
                      "startTime"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewWrites.createNative": {
      "post": {
        "operationId": "crewWrites.createNative",
        "summary": "crewWrites.createNative (mutation)",
        "description": "Requires scope: crew:create.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "abnOrGst": {
                        "type": "string"
                      },
                      "address": {
                        "type": "string"
                      },
                      "addressLatitude": {
                        "type": "number"
                      },
                      "addressLongitude": {
                        "type": "number"
                      },
                      "createdAt": {
                        "type": "number"
                      },
                      "crewRoleId": {
                        "type": "string"
                      },
                      "currency": {
                        "type": "string"
                      },
                      "dateOfBirth": {
                        "type": "number"
                      },
                      "defaultDayRate": {
                        "type": "number"
                      },
                      "defaultHourlyRate": {
                        "type": "number"
                      },
                      "department": {
                        "type": "string"
                      },
                      "email": {
                        "type": "string"
                      },
                      "emergencyContactName": {
                        "type": "string"
                      },
                      "emergencyContactPhone": {
                        "type": "string"
                      },
                      "firstName": {
                        "type": "string"
                      },
                      "icalEnabled": {
                        "type": "boolean"
                      },
                      "icalToken": {
                        "type": "string"
                      },
                      "image": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "lastName": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "overtimeMultiplier": {
                        "type": "number"
                      },
                      "phone": {
                        "type": "string"
                      },
                      "skillIds": {
                        "type": "array"
                      },
                      "status": {},
                      "tags": {
                        "type": "array"
                      },
                      "type": {},
                      "updatedAt": {
                        "type": "number"
                      },
                      "userId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "firstName",
                      "lastName"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewWrites.deleteNative": {
      "post": {
        "operationId": "crewWrites.deleteNative",
        "summary": "crewWrites.deleteNative (mutation)",
        "description": "Requires scope: crew:delete.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/crewWrites.updateNative": {
      "post": {
        "operationId": "crewWrites.updateNative",
        "summary": "crewWrites.updateNative (mutation)",
        "description": "Requires scope: crew:update.",
        "tags": [
          "crew"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clear": {
                        "type": "array"
                      },
                      "id": {
                        "type": "string"
                      },
                      "set": {}
                    },
                    "required": [
                      "clear",
                      "id",
                      "set"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/customFieldDefinitionsWrites.createNative": {
      "post": {
        "operationId": "customFieldDefinitionsWrites.createNative",
        "summary": "customFieldDefinitionsWrites.createNative (mutation)",
        "description": "Requires scope: orgSettings:update.",
        "tags": [
          "orgSettings"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "createdAt": {
                        "type": "number"
                      },
                      "entityType": {},
                      "fieldKey": {
                        "type": "string"
                      },
                      "fieldType": {},
                      "helpText": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "label": {
                        "type": "string"
                      },
                      "options": {
                        "type": "array"
                      },
                      "required": {
                        "type": "boolean"
                      },
                      "sortOrder": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "createdAt",
                      "entityType",
                      "fieldKey",
                      "fieldType",
                      "isActive",
                      "label",
                      "options",
                      "required",
                      "sortOrder"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/customFieldDefinitionsWrites.removeNative": {
      "post": {
        "operationId": "customFieldDefinitionsWrites.removeNative",
        "summary": "customFieldDefinitionsWrites.removeNative (mutation)",
        "description": "Requires scope: orgSettings:update.",
        "tags": [
          "orgSettings"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/customFieldDefinitionsWrites.updateNative": {
      "post": {
        "operationId": "customFieldDefinitionsWrites.updateNative",
        "summary": "customFieldDefinitionsWrites.updateNative (mutation)",
        "description": "Requires scope: orgSettings:update.",
        "tags": [
          "orgSettings"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "fieldType": {},
                      "helpText": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "label": {
                        "type": "string"
                      },
                      "options": {
                        "type": "array"
                      },
                      "required": {
                        "type": "boolean"
                      },
                      "sortOrder": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "fieldType",
                      "id",
                      "isActive",
                      "label",
                      "options",
                      "required",
                      "sortOrder"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/equipmentTab.bundle": {
      "post": {
        "operationId": "equipmentTab.bundle",
        "summary": "equipmentTab.bundle (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/groupTemplatesWrites.applyNative": {
      "post": {
        "operationId": "groupTemplatesWrites.applyNative",
        "summary": "groupTemplatesWrites.applyNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "categoryId": {
                        "type": "string"
                      },
                      "groupId": {
                        "type": "string"
                      },
                      "kitLineIds": {
                        "type": "array"
                      },
                      "modelLineIds": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "templateId": {
                        "type": "string"
                      },
                      "title": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "groupId",
                      "kitLineIds",
                      "modelLineIds",
                      "projectId",
                      "templateId",
                      "title"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/groupTemplatesWrites.deleteTemplateNative": {
      "post": {
        "operationId": "groupTemplatesWrites.deleteTemplateNative",
        "summary": "groupTemplatesWrites.deleteTemplateNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "templateId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "templateId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/groupTemplatesWrites.saveGroupAsTemplateNative": {
      "post": {
        "operationId": "groupTemplatesWrites.saveGroupAsTemplateNative",
        "summary": "groupTemplatesWrites.saveGroupAsTemplateNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string"
                      },
                      "groupId": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "templateId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "groupId",
                      "name",
                      "templateId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/groupTemplatesWrites.updateTemplateNative": {
      "post": {
        "operationId": "groupTemplatesWrites.updateTemplateNative",
        "summary": "groupTemplatesWrites.updateTemplateNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string"
                      },
                      "items": {
                        "type": "array"
                      },
                      "name": {
                        "type": "string"
                      },
                      "templateId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "templateId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/incidentWrites.reportIssueNative": {
      "post": {
        "operationId": "incidentWrites.reportIssueNative",
        "summary": "incidentWrites.reportIssueNative (mutation)",
        "description": "Requires scope: maintenance:create.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "incidentSeverity": {},
                      "incidentType": {},
                      "lineItemId": {
                        "type": "string"
                      },
                      "linkId": {
                        "type": "string"
                      },
                      "photos": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "recordId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "description",
                      "incidentSeverity",
                      "incidentType",
                      "linkId",
                      "photos",
                      "recordId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/invoicesWrites.createCreditNative": {
      "post": {
        "operationId": "invoicesWrites.createCreditNative",
        "summary": "invoicesWrites.createCreditNative (mutation)",
        "description": "Requires scope: invoice:create.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "creditForInvoiceId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "creditForInvoiceId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/invoicesWrites.createNative": {
      "post": {
        "operationId": "invoicesWrites.createNative",
        "summary": "invoicesWrites.createNative (mutation)",
        "description": "Requires scope: invoice:create.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clientId": {
                        "type": "string"
                      },
                      "depositPercent": {
                        "type": "number"
                      },
                      "dueDate": {
                        "type": "number"
                      },
                      "kind": {},
                      "notes": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "clientId",
                      "kind",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/invoicesWrites.deleteDraftNative": {
      "post": {
        "operationId": "invoicesWrites.deleteDraftNative",
        "summary": "invoicesWrites.deleteDraftNative (mutation)",
        "description": "Requires scope: invoice:delete.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/invoicesWrites.issueNative": {
      "post": {
        "operationId": "invoicesWrites.issueNative",
        "summary": "invoicesWrites.issueNative (mutation)",
        "description": "Requires scope: invoice:issue.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "autoNumber": {
                        "type": "object"
                      },
                      "dueDate": {
                        "type": "number"
                      },
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "autoNumber",
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/invoicesWrites.voidNative": {
      "post": {
        "operationId": "invoicesWrites.voidNative",
        "summary": "invoicesWrites.voidNative (mutation)",
        "description": "Requires scope: invoice:void.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "reason": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "reason"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitAllocationsWrites.clearNative": {
      "post": {
        "operationId": "kitAllocationsWrites.clearNative",
        "summary": "kitAllocationsWrites.clearNative (mutation)",
        "description": "Requires scope: kit:update.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitAllocationsWrites.replaceNative": {
      "post": {
        "operationId": "kitAllocationsWrites.replaceNative",
        "summary": "kitAllocationsWrites.replaceNative (mutation)",
        "description": "Requires scope: kit:update.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      },
                      "rows": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "kitId",
                      "rows"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitDetail.bundle": {
      "post": {
        "operationId": "kitDetail.bundle",
        "summary": "kitDetail.bundle (query)",
        "description": "Requires scope: kit:read.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kitId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kits.getById": {
      "post": {
        "operationId": "kits.getById",
        "summary": "kits.getById (query)",
        "description": "Requires scope: kit:read.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kits.list": {
      "post": {
        "operationId": "kits.list",
        "summary": "kits.list (query)",
        "description": "Requires scope: kit:read.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.addBulkItemNative": {
      "post": {
        "operationId": "kitWrites.addBulkItemNative",
        "summary": "kitWrites.addBulkItemNative (mutation)",
        "description": "Requires scope: kit:update.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "kitId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "position": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "bulkAssetId",
                      "kitId",
                      "quantity"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.addSerializedItemsNative": {
      "post": {
        "operationId": "kitWrites.addSerializedItemsNative",
        "summary": "kitWrites.addSerializedItemsNative (mutation)",
        "description": "Requires scope: kit:update.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "items": {
                        "type": "array"
                      },
                      "kitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "items",
                      "kitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.archiveNative": {
      "post": {
        "operationId": "kitWrites.archiveNative",
        "summary": "kitWrites.archiveNative (mutation)",
        "description": "Requires scope: kit:delete.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.createNative": {
      "post": {
        "operationId": "kitWrites.createNative",
        "summary": "kitWrites.createNative (mutation)",
        "description": "Requires scope: kit:create.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetTag": {
                        "type": "string"
                      },
                      "barcode": {
                        "type": "string"
                      },
                      "caseDimensions": {
                        "type": "string"
                      },
                      "caseType": {
                        "type": "string"
                      },
                      "categoryId": {
                        "type": "string"
                      },
                      "checkMode": {},
                      "condition": {},
                      "createdAt": {
                        "type": "number"
                      },
                      "customFieldValues": {},
                      "description": {
                        "type": "string"
                      },
                      "image": {
                        "type": "string"
                      },
                      "images": {
                        "type": "array"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "locationId": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "purchaseDate": {
                        "type": "number"
                      },
                      "purchasePrice": {
                        "type": "number"
                      },
                      "qrCode": {
                        "type": "string"
                      },
                      "status": {},
                      "tags": {
                        "type": "array"
                      },
                      "updatedAt": {
                        "type": "number"
                      },
                      "weight": {
                        "type": "number"
                      },
                      "xeroAccountCode": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "assetTag",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.deleteNative": {
      "post": {
        "operationId": "kitWrites.deleteNative",
        "summary": "kitWrites.deleteNative (mutation)",
        "description": "Requires scope: kit:delete.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.removeBulkItemNative": {
      "post": {
        "operationId": "kitWrites.removeBulkItemNative",
        "summary": "kitWrites.removeBulkItemNative (mutation)",
        "description": "Requires scope: kit:update.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "bulkItemId": {
                        "type": "string"
                      },
                      "kitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "bulkItemId",
                      "kitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.removeSerializedItemNative": {
      "post": {
        "operationId": "kitWrites.removeSerializedItemNative",
        "summary": "kitWrites.removeSerializedItemNative (mutation)",
        "description": "Requires scope: kit:update.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "kitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "assetId",
                      "kitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.updateNative": {
      "post": {
        "operationId": "kitWrites.updateNative",
        "summary": "kitWrites.updateNative (mutation)",
        "description": "Requires scope: kit:update.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "patch": {
                        "type": "object"
                      }
                    },
                    "required": [
                      "id",
                      "patch"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/kitWrites.updateNotesNative": {
      "post": {
        "operationId": "kitWrites.updateNotesNative",
        "summary": "kitWrites.updateNotesNative (mutation)",
        "description": "Requires scope: kit:update.",
        "tags": [
          "kit"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "notes": {}
                    },
                    "required": [
                      "id",
                      "notes"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.addCustomNative": {
      "post": {
        "operationId": "lineItemWrites.addCustomNative",
        "summary": "lineItemWrites.addCustomNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "emitSideEffects": {
                        "type": "boolean"
                      },
                      "fields": {
                        "type": "object"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "orgDefaultTaxRate": {},
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "fields",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.addKitNative": {
      "post": {
        "operationId": "lineItemWrites.addKitNative",
        "summary": "lineItemWrites.addKitNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "categoryId": {
                        "type": "string"
                      },
                      "discount": {
                        "type": "number"
                      },
                      "discountMode": {},
                      "emitActivity": {
                        "type": "boolean"
                      },
                      "groupId": {
                        "type": "string"
                      },
                      "groupName": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "kitId": {
                        "type": "string"
                      },
                      "kitLabel": {
                        "type": "string"
                      },
                      "orgDefaultTaxRate": {},
                      "pricingMode": {},
                      "projectId": {
                        "type": "string"
                      },
                      "unitPrice": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "kitId",
                      "kitLabel",
                      "pricingMode",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.addLineItemSmartNative": {
      "post": {
        "operationId": "lineItemWrites.addLineItemSmartNative",
        "summary": "lineItemWrites.addLineItemSmartNative (mutation)",
        "description": "Requires scope: project:manage_line_items or asset:update.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "accessoryPlan": {
                        "type": "object"
                      },
                      "allowOverbook": {
                        "type": "boolean"
                      },
                      "emitSideEffects": {
                        "type": "boolean"
                      },
                      "fields": {
                        "type": "object"
                      },
                      "forceSeparate": {
                        "type": "boolean"
                      },
                      "includeAccessories": {
                        "type": "boolean"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "orgDefaultTaxRate": {},
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "allowOverbook",
                      "fields",
                      "forceSeparate",
                      "includeAccessories",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.addNative": {
      "post": {
        "operationId": "lineItemWrites.addNative",
        "summary": "lineItemWrites.addNative (mutation)",
        "description": "Requires scope: project:manage_line_items or asset:update.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "accessoryPlan": {
                        "type": "object"
                      },
                      "allowOverbook": {
                        "type": "boolean"
                      },
                      "fields": {
                        "type": "object"
                      },
                      "includeAccessories": {
                        "type": "boolean"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "orgDefaultTaxRate": {},
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "allowOverbook",
                      "fields",
                      "includeAccessories",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.patchManyNative": {
      "post": {
        "operationId": "lineItemWrites.patchManyNative",
        "summary": "lineItemWrites.patchManyNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "patch": {
                        "type": "object"
                      }
                    },
                    "required": [
                      "ids",
                      "patch"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.patchNative": {
      "post": {
        "operationId": "lineItemWrites.patchNative",
        "summary": "lineItemWrites.patchNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "allowOverbook": {
                        "type": "boolean"
                      },
                      "clear": {
                        "type": "array"
                      },
                      "emitSideEffects": {
                        "type": "boolean"
                      },
                      "entityName": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "orgDefaultTaxRate": {},
                      "set": {}
                    },
                    "required": [
                      "allowOverbook",
                      "clear",
                      "entityName",
                      "id",
                      "set"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.recalcAutoPricedLinesNative": {
      "post": {
        "operationId": "lineItemWrites.recalcAutoPricedLinesNative",
        "summary": "lineItemWrites.recalcAutoPricedLinesNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.recalcNative": {
      "post": {
        "operationId": "lineItemWrites.recalcNative",
        "summary": "lineItemWrites.recalcNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "orgDefaultTaxRate": {},
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.removeManyNative": {
      "post": {
        "operationId": "lineItemWrites.removeManyNative",
        "summary": "lineItemWrites.removeManyNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      },
                      "justification": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "ids"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.removeNative": {
      "post": {
        "operationId": "lineItemWrites.removeNative",
        "summary": "lineItemWrites.removeNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "emitSideEffects": {
                        "type": "boolean"
                      },
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "orgDefaultTaxRate": {}
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.reorderNative": {
      "post": {
        "operationId": "lineItemWrites.reorderNative",
        "summary": "lineItemWrites.reorderNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "items": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "items"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.unsellLineItemNative": {
      "post": {
        "operationId": "lineItemWrites.unsellLineItemNative",
        "summary": "lineItemWrites.unsellLineItemNative (mutation)",
        "description": "Requires scope: project:manage_line_items or asset:update.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/lineItemWrites.updateAccessoryPlanNative": {
      "post": {
        "operationId": "lineItemWrites.updateAccessoryPlanNative",
        "summary": "lineItemWrites.updateAccessoryPlanNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "accessoryPlan": {
                        "type": "object"
                      },
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "accessoryPlan",
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/locationsWrites.createNative": {
      "post": {
        "operationId": "locationsWrites.createNative",
        "summary": "locationsWrites.createNative (mutation)",
        "description": "Requires scope: location:create.",
        "tags": [
          "location"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "address": {
                        "type": "string"
                      },
                      "isDefault": {
                        "type": "boolean"
                      },
                      "latitude": {},
                      "longitude": {},
                      "name": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "parentId": {
                        "type": "string"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "type": {}
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/locationsWrites.removeNative": {
      "post": {
        "operationId": "locationsWrites.removeNative",
        "summary": "locationsWrites.removeNative (mutation)",
        "description": "Requires scope: location:delete.",
        "tags": [
          "location"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/locationsWrites.updateNative": {
      "post": {
        "operationId": "locationsWrites.updateNative",
        "summary": "locationsWrites.updateNative (mutation)",
        "description": "Requires scope: location:update.",
        "tags": [
          "location"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "address": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "isDefault": {
                        "type": "boolean"
                      },
                      "latitude": {},
                      "longitude": {},
                      "name": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "parentId": {
                        "type": "string"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "type": {}
                    },
                    "required": [
                      "id",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/locationsWrites.updateNotesNative": {
      "post": {
        "operationId": "locationsWrites.updateNotesNative",
        "summary": "locationsWrites.updateNotesNative (mutation)",
        "description": "Requires scope: location:update.",
        "tags": [
          "location"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "notes": {}
                    },
                    "required": [
                      "id",
                      "notes"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/maintenanceCheckoffWrites.checkOffBulkSession": {
      "post": {
        "operationId": "maintenanceCheckoffWrites.checkOffBulkSession",
        "summary": "maintenanceCheckoffWrites.checkOffBulkSession (mutation)",
        "description": "Requires scope: maintenance:update.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "checkAllRemaining": {
                        "type": "boolean"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "recordId": {
                        "type": "string"
                      },
                      "sessionId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "bulkAssetId",
                      "recordId",
                      "sessionId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/maintenanceCheckoffWrites.checkOffUnit": {
      "post": {
        "operationId": "maintenanceCheckoffWrites.checkOffUnit",
        "summary": "maintenanceCheckoffWrites.checkOffUnit (mutation)",
        "description": "Requires scope: maintenance:update.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "checkoffId": {
                        "type": "string"
                      },
                      "recordId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "assetId",
                      "checkoffId",
                      "recordId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/maintenanceRecords.getById": {
      "post": {
        "operationId": "maintenanceRecords.getById",
        "summary": "maintenanceRecords.getById (query)",
        "description": "Requires scope: maintenance:read.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/maintenanceRecords.list": {
      "post": {
        "operationId": "maintenanceRecords.list",
        "summary": "maintenanceRecords.list (query)",
        "description": "Requires scope: maintenance:read.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/maintenanceScheduleWorklist.dueWorklist": {
      "post": {
        "operationId": "maintenanceScheduleWorklist.dueWorklist",
        "summary": "maintenanceScheduleWorklist.dueWorklist (query)",
        "description": "Requires scope: maintenance:read.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "nowMs": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "nowMs"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/maintenanceWrites.createNative": {
      "post": {
        "operationId": "maintenanceWrites.createNative",
        "summary": "maintenanceWrites.createNative (mutation)",
        "description": "Requires scope: maintenance:create.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetLinks": {
                        "type": "array"
                      },
                      "assignedToId": {
                        "type": "string"
                      },
                      "completedDate": {
                        "type": "number"
                      },
                      "cost": {
                        "type": "number"
                      },
                      "description": {
                        "type": "string"
                      },
                      "emitSideEffects": {
                        "type": "boolean"
                      },
                      "nextDueDate": {
                        "type": "number"
                      },
                      "partsUsed": {
                        "type": "string"
                      },
                      "photos": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "recordId": {
                        "type": "string"
                      },
                      "reportedById": {
                        "type": "string"
                      },
                      "result": {},
                      "scheduledDate": {
                        "type": "number"
                      },
                      "status": {},
                      "tags": {
                        "type": "array"
                      },
                      "title": {
                        "type": "string"
                      },
                      "type": {}
                    },
                    "required": [
                      "assetLinks",
                      "recordId",
                      "title",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/maintenanceWrites.deleteNative": {
      "post": {
        "operationId": "maintenanceWrites.deleteNative",
        "summary": "maintenanceWrites.deleteNative (mutation)",
        "description": "Requires scope: maintenance:delete.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/maintenanceWrites.updateNative": {
      "post": {
        "operationId": "maintenanceWrites.updateNative",
        "summary": "maintenanceWrites.updateNative (mutation)",
        "description": "Requires scope: maintenance:update.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetLinks": {
                        "type": "array"
                      },
                      "assignedToId": {
                        "type": "string"
                      },
                      "completedDate": {
                        "type": "number"
                      },
                      "cost": {
                        "type": "number"
                      },
                      "description": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "nextDueDate": {
                        "type": "number"
                      },
                      "partsUsed": {
                        "type": "string"
                      },
                      "photos": {
                        "type": "array"
                      },
                      "reportedById": {
                        "type": "string"
                      },
                      "result": {},
                      "scheduledDate": {
                        "type": "number"
                      },
                      "status": {},
                      "tags": {
                        "type": "array"
                      },
                      "title": {
                        "type": "string"
                      },
                      "type": {}
                    },
                    "required": [
                      "assetLinks",
                      "id",
                      "title",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/modelBulkAccessoriesWrites.addNative": {
      "post": {
        "operationId": "modelBulkAccessoriesWrites.addNative",
        "summary": "modelBulkAccessoriesWrites.addNative (mutation)",
        "description": "Requires scope: model:update.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "inclusion": {},
                      "modelId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "bulkAssetId",
                      "modelId",
                      "quantity"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/modelBulkAccessoriesWrites.removeNative": {
      "post": {
        "operationId": "modelBulkAccessoriesWrites.removeNative",
        "summary": "modelBulkAccessoriesWrites.removeNative (mutation)",
        "description": "Requires scope: model:update.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "accessoryId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "accessoryId",
                      "modelId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/modelBulkAccessoriesWrites.updateNative": {
      "post": {
        "operationId": "modelBulkAccessoriesWrites.updateNative",
        "summary": "modelBulkAccessoriesWrites.updateNative (mutation)",
        "description": "Requires scope: model:update.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "accessoryId": {
                        "type": "string"
                      },
                      "inclusion": {},
                      "modelId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "accessoryId",
                      "modelId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/models.detail": {
      "post": {
        "operationId": "models.detail",
        "summary": "models.detail (query)",
        "description": "Requires scope: model:read.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/models.getById": {
      "post": {
        "operationId": "models.getById",
        "summary": "models.getById (query)",
        "description": "Requires scope: model:read.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/models.list": {
      "post": {
        "operationId": "models.list",
        "summary": "models.list (query)",
        "description": "Requires scope: model:read.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/modelWrites.archiveNative": {
      "post": {
        "operationId": "modelWrites.archiveNative",
        "summary": "modelWrites.archiveNative (mutation)",
        "description": "Requires scope: model:delete.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/modelWrites.bulkUpdateRatesNative": {
      "post": {
        "operationId": "modelWrites.bulkUpdateRatesNative",
        "summary": "modelWrites.bulkUpdateRatesNative (mutation)",
        "description": "Requires scope: model:update.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "modelIds": {
                        "type": "array"
                      },
                      "operation": {},
                      "rateType": {},
                      "value": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "modelIds",
                      "operation",
                      "rateType",
                      "value"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/modelWrites.createNative": {
      "post": {
        "operationId": "modelWrites.createNative",
        "summary": "modelWrites.createNative (mutation)",
        "description": "Requires scope: model:create.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetType": {},
                      "barcodeLabelTemplate": {
                        "type": "string"
                      },
                      "categoryId": {
                        "type": "string"
                      },
                      "customFields": {},
                      "dailyRate": {
                        "type": "number"
                      },
                      "defaultApplianceType": {},
                      "defaultEquipmentClass": {},
                      "defaultPurchasePrice": {
                        "type": "number"
                      },
                      "defaultRentalPrice": {
                        "type": "number"
                      },
                      "defaultTestProfileId": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "image": {
                        "type": "string"
                      },
                      "images": {
                        "type": "array"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "maintenanceIntervalDays": {
                        "type": "number"
                      },
                      "manuals": {
                        "type": "array"
                      },
                      "manufacturer": {
                        "type": "string"
                      },
                      "modelNumber": {
                        "type": "string"
                      },
                      "monthlyRate": {
                        "type": "number"
                      },
                      "name": {
                        "type": "string"
                      },
                      "powerDraw": {
                        "type": "number"
                      },
                      "replacementCost": {
                        "type": "number"
                      },
                      "requiresTestAndTag": {
                        "type": "boolean"
                      },
                      "salePrice": {
                        "type": "number"
                      },
                      "saleStockQuantity": {
                        "type": "number"
                      },
                      "sku": {
                        "type": "string"
                      },
                      "specifications": {},
                      "tags": {
                        "type": "array"
                      },
                      "testAndTagIntervalDays": {
                        "type": "number"
                      },
                      "weeklyRate": {
                        "type": "number"
                      },
                      "weight": {
                        "type": "number"
                      },
                      "xeroRentalAccountCode": {
                        "type": "string"
                      },
                      "xeroSaleAccountCode": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/modelWrites.updateNative": {
      "post": {
        "operationId": "modelWrites.updateNative",
        "summary": "modelWrites.updateNative (mutation)",
        "description": "Requires scope: model:update.",
        "tags": [
          "model"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetType": {},
                      "barcodeLabelTemplate": {
                        "type": "string"
                      },
                      "categoryId": {
                        "type": "string"
                      },
                      "customFields": {},
                      "dailyRate": {
                        "type": "number"
                      },
                      "defaultApplianceType": {},
                      "defaultEquipmentClass": {},
                      "defaultPurchasePrice": {
                        "type": "number"
                      },
                      "defaultRentalPrice": {
                        "type": "number"
                      },
                      "defaultTestProfileId": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "image": {
                        "type": "string"
                      },
                      "images": {
                        "type": "array"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "maintenanceIntervalDays": {
                        "type": "number"
                      },
                      "manuals": {
                        "type": "array"
                      },
                      "manufacturer": {
                        "type": "string"
                      },
                      "modelNumber": {
                        "type": "string"
                      },
                      "monthlyRate": {
                        "type": "number"
                      },
                      "name": {
                        "type": "string"
                      },
                      "powerDraw": {
                        "type": "number"
                      },
                      "replacementCost": {
                        "type": "number"
                      },
                      "requiresTestAndTag": {
                        "type": "boolean"
                      },
                      "salePrice": {
                        "type": "number"
                      },
                      "saleStockQuantity": {
                        "type": "number"
                      },
                      "sku": {
                        "type": "string"
                      },
                      "specifications": {},
                      "tags": {
                        "type": "array"
                      },
                      "testAndTagIntervalDays": {
                        "type": "number"
                      },
                      "weeklyRate": {
                        "type": "number"
                      },
                      "weight": {
                        "type": "number"
                      },
                      "xeroRentalAccountCode": {
                        "type": "string"
                      },
                      "xeroSaleAccountCode": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/notificationDismissalsWrites.dismissManyNative": {
      "post": {
        "operationId": "notificationDismissalsWrites.dismissManyNative",
        "summary": "notificationDismissalsWrites.dismissManyNative (mutation)",
        "description": "Requires scope: self:write.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "items": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "items"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/notificationDismissalsWrites.mine": {
      "post": {
        "operationId": "notificationDismissalsWrites.mine",
        "summary": "notificationDismissalsWrites.mine (query)",
        "description": "Requires scope: self:read.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/notificationDismissalsWrites.pruneStaleNative": {
      "post": {
        "operationId": "notificationDismissalsWrites.pruneStaleNative",
        "summary": "notificationDismissalsWrites.pruneStaleNative (mutation)",
        "description": "Requires scope: self:write.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "activeKeys": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "activeKeys"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/overbooking.bundle": {
      "post": {
        "operationId": "overbooking.bundle",
        "summary": "overbooking.bundle (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "modelIds": {
                        "type": "array"
                      },
                      "rentalEndDate": {
                        "type": "number"
                      },
                      "rentalStartDate": {
                        "type": "number"
                      },
                      "thisProjectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "modelIds"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/overbookingBoard.bundle": {
      "post": {
        "operationId": "overbookingBoard.bundle",
        "summary": "overbookingBoard.bundle (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "rangeEnd": {
                        "type": "number"
                      },
                      "rangeStart": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "rangeEnd",
                      "rangeStart"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/overbookingBoard.confirmImpact": {
      "post": {
        "operationId": "overbookingBoard.confirmImpact",
        "summary": "overbookingBoard.confirmImpact (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/overbookingBoard.counts": {
      "post": {
        "operationId": "overbookingBoard.counts",
        "summary": "overbookingBoard.counts (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "rangeEnd": {
                        "type": "number"
                      },
                      "rangeStart": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "rangeEnd",
                      "rangeStart"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectCategoriesWrites.createCategoryNative": {
      "post": {
        "operationId": "projectCategoriesWrites.createCategoryNative",
        "summary": "projectCategoriesWrites.createCategoryNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "justification": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "name",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectCategoriesWrites.deleteCategoryNative": {
      "post": {
        "operationId": "projectCategoriesWrites.deleteCategoryNative",
        "summary": "projectCategoriesWrites.deleteCategoryNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectCategoriesWrites.reorderCategoriesNative": {
      "post": {
        "operationId": "projectCategoriesWrites.reorderCategoriesNative",
        "summary": "projectCategoriesWrites.reorderCategoriesNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "orderedIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "orderedIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectCategoriesWrites.updateCategoryNative": {
      "post": {
        "operationId": "projectCategoriesWrites.updateCategoryNative",
        "summary": "projectCategoriesWrites.updateCategoryNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "sortOrder": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectCosts.operationalCosts": {
      "post": {
        "operationId": "projectCosts.operationalCosts",
        "summary": "projectCosts.operationalCosts (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectDetail.bundle": {
      "post": {
        "operationId": "projectDetail.bundle",
        "summary": "projectDetail.bundle (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectEquipment.browserBundle": {
      "post": {
        "operationId": "projectEquipment.browserBundle",
        "summary": "projectEquipment.browserBundle (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroups.getById": {
      "post": {
        "operationId": "projectGroups.getById",
        "summary": "projectGroups.getById (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroups.listByProject": {
      "post": {
        "operationId": "projectGroups.listByProject",
        "summary": "projectGroups.listByProject (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroupsWrites.createGroupNative": {
      "post": {
        "operationId": "projectGroupsWrites.createGroupNative",
        "summary": "projectGroupsWrites.createGroupNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "categoryId": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "discount": {
                        "type": "number"
                      },
                      "discountMode": {},
                      "justification": {
                        "type": "string"
                      },
                      "price": {
                        "type": "number"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "title": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId",
                      "title"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroupsWrites.deleteGroupNative": {
      "post": {
        "operationId": "projectGroupsWrites.deleteGroupNative",
        "summary": "projectGroupsWrites.deleteGroupNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroupsWrites.moveLineItemNative": {
      "post": {
        "operationId": "projectGroupsWrites.moveLineItemNative",
        "summary": "projectGroupsWrites.moveLineItemNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "justification": {
                        "type": "string"
                      },
                      "lineItemId": {
                        "type": "string"
                      },
                      "targetCategoryId": {},
                      "targetGroupId": {}
                    },
                    "required": [
                      "lineItemId",
                      "targetCategoryId",
                      "targetGroupId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroupsWrites.moveLineItemsNative": {
      "post": {
        "operationId": "projectGroupsWrites.moveLineItemsNative",
        "summary": "projectGroupsWrites.moveLineItemsNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "justification": {
                        "type": "string"
                      },
                      "lineItemIds": {
                        "type": "array"
                      },
                      "targetCategoryId": {},
                      "targetGroupId": {}
                    },
                    "required": [
                      "lineItemIds",
                      "targetCategoryId",
                      "targetGroupId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroupsWrites.reorderGroupsNative": {
      "post": {
        "operationId": "projectGroupsWrites.reorderGroupsNative",
        "summary": "projectGroupsWrites.reorderGroupsNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "orderedIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "orderedIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroupsWrites.updateGroupNative": {
      "post": {
        "operationId": "projectGroupsWrites.updateGroupNative",
        "summary": "projectGroupsWrites.updateGroupNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "sortOrder": {
                        "type": "number"
                      },
                      "title": {
                        "type": "string"
                      },
                      "xeroAccountCode": {
                        "type": "string"
                      },
                      "xeroTaxType": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectGroupsWrites.updateGroupPriceNative": {
      "post": {
        "operationId": "projectGroupsWrites.updateGroupPriceNative",
        "summary": "projectGroupsWrites.updateGroupPriceNative (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "discount": {
                        "type": "number"
                      },
                      "discountMode": {},
                      "id": {
                        "type": "string"
                      },
                      "price": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "id",
                      "price"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectLineItems.getById": {
      "post": {
        "operationId": "projectLineItems.getById",
        "summary": "projectLineItems.getById (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectLineItems.list": {
      "post": {
        "operationId": "projectLineItems.list",
        "summary": "projectLineItems.list (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectLineItems.listByProject": {
      "post": {
        "operationId": "projectLineItems.listByProject",
        "summary": "projectLineItems.listByProject (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectLineItems.swapLineItemAsset": {
      "post": {
        "operationId": "projectLineItems.swapLineItemAsset",
        "summary": "projectLineItems.swapLineItemAsset (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "lineItemId": {
                        "type": "string"
                      },
                      "newAssetId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "lineItemId",
                      "newAssetId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectLocksRead.currentEntries": {
      "post": {
        "operationId": "projectLocksRead.currentEntries",
        "summary": "projectLocksRead.currentEntries (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectLocksRead.listSnapshots": {
      "post": {
        "operationId": "projectLocksRead.listSnapshots",
        "summary": "projectLocksRead.listSnapshots (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectLocksRead.snapshotEntries": {
      "post": {
        "operationId": "projectLocksRead.snapshotEntries",
        "summary": "projectLocksRead.snapshotEntries (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "snapshotId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "snapshotId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectLocksRead.status": {
      "post": {
        "operationId": "projectLocksRead.status",
        "summary": "projectLocksRead.status (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectManagersWrites.addNative": {
      "post": {
        "operationId": "projectManagersWrites.addNative",
        "summary": "projectManagersWrites.addNative (mutation)",
        "description": "Requires scope: project:manage.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      },
                      "userId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId",
                      "userId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectManagersWrites.removeNative": {
      "post": {
        "operationId": "projectManagersWrites.removeNative",
        "summary": "projectManagersWrites.removeNative (mutation)",
        "description": "Requires scope: project:manage.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      },
                      "userId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId",
                      "userId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectManagersWrites.setNative": {
      "post": {
        "operationId": "projectManagersWrites.setNative",
        "summary": "projectManagersWrites.setNative (mutation)",
        "description": "Requires scope: project:manage.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "auditPrefix": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "userIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "auditPrefix",
                      "projectId",
                      "userIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projects.getById": {
      "post": {
        "operationId": "projects.getById",
        "summary": "projects.getById (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projects.list": {
      "post": {
        "operationId": "projects.list",
        "summary": "projects.list (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projects.listPage": {
      "post": {
        "operationId": "projects.listPage",
        "summary": "projects.listPage (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "page": {
                        "type": "number"
                      },
                      "pageSize": {
                        "type": "number"
                      },
                      "search": {
                        "type": "string"
                      },
                      "sortBy": {
                        "type": "string"
                      },
                      "sortOrder": {},
                      "statusIn": {
                        "type": "array"
                      },
                      "typeIn": {
                        "type": "array"
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.bulkDeleteServicesNative": {
      "post": {
        "operationId": "projectServicesWrites.bulkDeleteServicesNative",
        "summary": "projectServicesWrites.bulkDeleteServicesNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "ids"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.bulkUpdateServiceStatusNative": {
      "post": {
        "operationId": "projectServicesWrites.bulkUpdateServiceStatusNative",
        "summary": "projectServicesWrites.bulkUpdateServiceStatusNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      },
                      "status": {}
                    },
                    "required": [
                      "ids",
                      "status"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.cloneServicesNative": {
      "post": {
        "operationId": "projectServicesWrites.cloneServicesNative",
        "summary": "projectServicesWrites.cloneServicesNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "sourceProjectId": {
                        "type": "string"
                      },
                      "targetProjectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "sourceProjectId",
                      "targetProjectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.convertLineItemToServiceNative": {
      "post": {
        "operationId": "projectServicesWrites.convertLineItemToServiceNative",
        "summary": "projectServicesWrites.convertLineItemToServiceNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "lineItemId": {
                        "type": "string"
                      },
                      "serviceId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "lineItemId",
                      "serviceId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.createServiceNative": {
      "post": {
        "operationId": "projectServicesWrites.createServiceNative",
        "summary": "projectServicesWrites.createServiceNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "address": {
                        "type": "string"
                      },
                      "chargeRateOverride": {
                        "type": "number"
                      },
                      "costTotal": {
                        "type": "number"
                      },
                      "crew": {
                        "type": "array"
                      },
                      "crewCountRequired": {
                        "type": "number"
                      },
                      "crewRoleId": {
                        "type": "string"
                      },
                      "date": {
                        "type": "number"
                      },
                      "description": {
                        "type": "string"
                      },
                      "discount": {
                        "type": "number"
                      },
                      "duration": {
                        "type": "number"
                      },
                      "endDate": {
                        "type": "number"
                      },
                      "endTime": {
                        "type": "string"
                      },
                      "estimatedDuration": {
                        "type": "number"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "latitude": {
                        "type": "number"
                      },
                      "longitude": {
                        "type": "number"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "numberOfTrips": {
                        "type": "number"
                      },
                      "pricingType": {},
                      "projectId": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "scheduledTime": {
                        "type": "string"
                      },
                      "showOnDocuments": {
                        "type": "boolean"
                      },
                      "startTime": {
                        "type": "string"
                      },
                      "taxable": {
                        "type": "boolean"
                      },
                      "title": {
                        "type": "string"
                      },
                      "type": {},
                      "unitPrice": {
                        "type": "number"
                      },
                      "vehicleDescription": {
                        "type": "string"
                      },
                      "xeroAccountCode": {
                        "type": "string"
                      },
                      "xeroTaxType": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId",
                      "quantity",
                      "showOnDocuments",
                      "taxable",
                      "title",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.createServiceTemplateNative": {
      "post": {
        "operationId": "projectServicesWrites.createServiceTemplateNative",
        "summary": "projectServicesWrites.createServiceTemplateNative (mutation)",
        "description": "Requires scope: orgSettings:update.",
        "tags": [
          "orgSettings"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "defaultCrewCount": {
                        "type": "number"
                      },
                      "defaultPricingType": {},
                      "defaultUnitPrice": {
                        "type": "number"
                      },
                      "defaultVehicle": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "isAutoAdded": {
                        "type": "boolean"
                      },
                      "showOnDocuments": {
                        "type": "boolean"
                      },
                      "title": {
                        "type": "string"
                      },
                      "type": {}
                    },
                    "required": [
                      "isActive",
                      "isAutoAdded",
                      "showOnDocuments",
                      "title",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.deleteServiceNative": {
      "post": {
        "operationId": "projectServicesWrites.deleteServiceNative",
        "summary": "projectServicesWrites.deleteServiceNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.deleteServiceTemplateNative": {
      "post": {
        "operationId": "projectServicesWrites.deleteServiceTemplateNative",
        "summary": "projectServicesWrites.deleteServiceTemplateNative (mutation)",
        "description": "Requires scope: orgSettings:update.",
        "tags": [
          "orgSettings"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.generateServicesNative": {
      "post": {
        "operationId": "projectServicesWrites.generateServicesNative",
        "summary": "projectServicesWrites.generateServicesNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.updateServiceNative": {
      "post": {
        "operationId": "projectServicesWrites.updateServiceNative",
        "summary": "projectServicesWrites.updateServiceNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "address": {
                        "type": "string"
                      },
                      "chargeRateOverride": {
                        "type": "number"
                      },
                      "costTotal": {
                        "type": "number"
                      },
                      "crew": {
                        "type": "array"
                      },
                      "crewCountRequired": {
                        "type": "number"
                      },
                      "crewRoleId": {
                        "type": "string"
                      },
                      "date": {
                        "type": "number"
                      },
                      "description": {
                        "type": "string"
                      },
                      "discount": {
                        "type": "number"
                      },
                      "duration": {
                        "type": "number"
                      },
                      "endDate": {
                        "type": "number"
                      },
                      "endTime": {
                        "type": "string"
                      },
                      "estimatedDuration": {
                        "type": "number"
                      },
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "latitude": {
                        "type": "number"
                      },
                      "longitude": {
                        "type": "number"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "numberOfTrips": {
                        "type": "number"
                      },
                      "pricingType": {},
                      "quantity": {
                        "type": "number"
                      },
                      "scheduledTime": {
                        "type": "string"
                      },
                      "showOnDocuments": {
                        "type": "boolean"
                      },
                      "startTime": {
                        "type": "string"
                      },
                      "taxable": {
                        "type": "boolean"
                      },
                      "title": {
                        "type": "string"
                      },
                      "type": {},
                      "unitPrice": {
                        "type": "number"
                      },
                      "vehicleDescription": {
                        "type": "string"
                      },
                      "xeroAccountCode": {
                        "type": "string"
                      },
                      "xeroTaxType": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "quantity",
                      "showOnDocuments",
                      "taxable",
                      "title",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.updateServiceStatusNative": {
      "post": {
        "operationId": "projectServicesWrites.updateServiceStatusNative",
        "summary": "projectServicesWrites.updateServiceStatusNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "status": {}
                    },
                    "required": [
                      "id",
                      "status"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectServicesWrites.updateServiceTemplateNative": {
      "post": {
        "operationId": "projectServicesWrites.updateServiceTemplateNative",
        "summary": "projectServicesWrites.updateServiceTemplateNative (mutation)",
        "description": "Requires scope: orgSettings:update.",
        "tags": [
          "orgSettings"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "defaultCrewCount": {
                        "type": "number"
                      },
                      "defaultPricingType": {},
                      "defaultUnitPrice": {
                        "type": "number"
                      },
                      "defaultVehicle": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "isAutoAdded": {
                        "type": "boolean"
                      },
                      "showOnDocuments": {
                        "type": "boolean"
                      },
                      "title": {
                        "type": "string"
                      },
                      "type": {}
                    },
                    "required": [
                      "id",
                      "isActive",
                      "isAutoAdded",
                      "showOnDocuments",
                      "title",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectTasksWrites.bulkDeleteNative": {
      "post": {
        "operationId": "projectTasksWrites.bulkDeleteNative",
        "summary": "projectTasksWrites.bulkDeleteNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "ids": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "ids"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectTasksWrites.bulkUpdateNative": {
      "post": {
        "operationId": "projectTasksWrites.bulkUpdateNative",
        "summary": "projectTasksWrites.bulkUpdateNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assigneeCrewId": {},
                      "assigneeUserId": {},
                      "dueDate": {},
                      "ids": {
                        "type": "array"
                      },
                      "priority": {},
                      "status": {}
                    },
                    "required": [
                      "ids"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectTasksWrites.createNative": {
      "post": {
        "operationId": "projectTasksWrites.createNative",
        "summary": "projectTasksWrites.createNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assigneeCrewId": {},
                      "assigneeUserId": {},
                      "checklist": {},
                      "description": {},
                      "dueDate": {},
                      "priority": {},
                      "projectId": {
                        "type": "string"
                      },
                      "status": {},
                      "title": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId",
                      "title"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectTasksWrites.deleteNative": {
      "post": {
        "operationId": "projectTasksWrites.deleteNative",
        "summary": "projectTasksWrites.deleteNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectTasksWrites.updateNative": {
      "post": {
        "operationId": "projectTasksWrites.updateNative",
        "summary": "projectTasksWrites.updateNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assigneeCrewId": {},
                      "assigneeUserId": {},
                      "checklist": {},
                      "description": {},
                      "dueDate": {},
                      "id": {
                        "type": "string"
                      },
                      "priority": {},
                      "status": {},
                      "title": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectUnlockSessionsWrites.commitNative": {
      "post": {
        "operationId": "projectUnlockSessionsWrites.commitNative",
        "summary": "projectUnlockSessionsWrites.commitNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "note": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectUnlockSessionsWrites.discardNative": {
      "post": {
        "operationId": "projectUnlockSessionsWrites.discardNative",
        "summary": "projectUnlockSessionsWrites.discardNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectUnlockSessionsWrites.openNative": {
      "post": {
        "operationId": "projectUnlockSessionsWrites.openNative",
        "summary": "projectUnlockSessionsWrites.openNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "justification": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "scope": {}
                    },
                    "required": [
                      "justification",
                      "projectId",
                      "scope"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.archiveNative": {
      "post": {
        "operationId": "projectWrites.archiveNative",
        "summary": "projectWrites.archiveNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.createNative": {
      "post": {
        "operationId": "projectWrites.createNative",
        "summary": "projectWrites.createNative (mutation)",
        "description": "Requires scope: project:create.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "autoNumber": {
                        "type": "object"
                      },
                      "billingDaysOverride": {
                        "type": "number"
                      },
                      "billingWeeksOverride": {
                        "type": "number"
                      },
                      "clientContactId": {
                        "type": "string"
                      },
                      "clientId": {
                        "type": "string"
                      },
                      "clientNotes": {
                        "type": "string"
                      },
                      "createdAt": {
                        "type": "number"
                      },
                      "crewNotes": {
                        "type": "string"
                      },
                      "depositPaid": {
                        "type": "number"
                      },
                      "description": {
                        "type": "string"
                      },
                      "discountAmount": {
                        "type": "number"
                      },
                      "discountPercent": {
                        "type": "number"
                      },
                      "equipmentRevenue": {
                        "type": "number"
                      },
                      "eventEndDate": {
                        "type": "number"
                      },
                      "eventEndTime": {
                        "type": "string"
                      },
                      "eventStartDate": {
                        "type": "number"
                      },
                      "eventStartTime": {
                        "type": "string"
                      },
                      "internalNotes": {
                        "type": "string"
                      },
                      "invoicedTotal": {
                        "type": "number"
                      },
                      "isTemplate": {
                        "type": "boolean"
                      },
                      "labourCostTotal": {
                        "type": "number"
                      },
                      "loadInDate": {
                        "type": "number"
                      },
                      "loadInTime": {
                        "type": "string"
                      },
                      "loadOutDate": {
                        "type": "number"
                      },
                      "loadOutTime": {
                        "type": "string"
                      },
                      "locationId": {
                        "type": "string"
                      },
                      "margin": {
                        "type": "number"
                      },
                      "name": {
                        "type": "string"
                      },
                      "projectEndDate": {
                        "type": "number"
                      },
                      "projectEndTime": {
                        "type": "string"
                      },
                      "projectManagerId": {
                        "type": "string"
                      },
                      "projectNumber": {
                        "type": "string"
                      },
                      "projectStartDate": {
                        "type": "number"
                      },
                      "projectStartTime": {
                        "type": "string"
                      },
                      "rentalEndDate": {
                        "type": "number"
                      },
                      "rentalStartDate": {
                        "type": "number"
                      },
                      "serviceCostTotal": {
                        "type": "number"
                      },
                      "siteContactEmail": {
                        "type": "string"
                      },
                      "siteContactName": {
                        "type": "string"
                      },
                      "siteContactPhone": {
                        "type": "string"
                      },
                      "status": {},
                      "subHireCostTotal": {
                        "type": "number"
                      },
                      "subtotal": {
                        "type": "number"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "taxAmount": {
                        "type": "number"
                      },
                      "taxRate": {
                        "type": "number"
                      },
                      "total": {
                        "type": "number"
                      },
                      "type": {},
                      "updatedAt": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.deleteNative": {
      "post": {
        "operationId": "projectWrites.deleteNative",
        "summary": "projectWrites.deleteNative (mutation)",
        "description": "Requires scope: project:delete.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "defaultLocationId": {},
                      "freedAssets": {
                        "type": "number"
                      },
                      "freedKits": {
                        "type": "number"
                      },
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "defaultLocationId",
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.deleteTemplateNative": {
      "post": {
        "operationId": "projectWrites.deleteTemplateNative",
        "summary": "projectWrites.deleteTemplateNative (mutation)",
        "description": "Requires scope: project:delete.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.duplicateNative": {
      "post": {
        "operationId": "projectWrites.duplicateNative",
        "summary": "projectWrites.duplicateNative (mutation)",
        "description": "Requires scope: project:create.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "newId": {
                        "type": "string"
                      },
                      "newName": {
                        "type": "string"
                      },
                      "newProjectNumber": {
                        "type": "string"
                      },
                      "orgDefaultTaxRate": {},
                      "sourceId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "newId",
                      "newName",
                      "newProjectNumber",
                      "sourceId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.saveAsTemplateNative": {
      "post": {
        "operationId": "projectWrites.saveAsTemplateNative",
        "summary": "projectWrites.saveAsTemplateNative (mutation)",
        "description": "Requires scope: project:create.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "newId": {
                        "type": "string"
                      },
                      "orgDefaultTaxRate": {},
                      "sourceId": {
                        "type": "string"
                      },
                      "templateName": {
                        "type": "string"
                      },
                      "templateNumber": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "newId",
                      "sourceId",
                      "templateName",
                      "templateNumber"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.updateNative": {
      "post": {
        "operationId": "projectWrites.updateNative",
        "summary": "projectWrites.updateNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "clear": {
                        "type": "array"
                      },
                      "id": {
                        "type": "string"
                      },
                      "set": {}
                    },
                    "required": [
                      "clear",
                      "id",
                      "set"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.updateNotesNative": {
      "post": {
        "operationId": "projectWrites.updateNotesNative",
        "summary": "projectWrites.updateNotesNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "field": {},
                      "id": {
                        "type": "string"
                      },
                      "notes": {}
                    },
                    "required": [
                      "field",
                      "id",
                      "notes"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/projectWrites.updateStatusNative": {
      "post": {
        "operationId": "projectWrites.updateStatusNative",
        "summary": "projectWrites.updateStatusNative (mutation)",
        "description": "Requires scope: project:update.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "emitSideEffects": {
                        "type": "boolean"
                      },
                      "id": {
                        "type": "string"
                      },
                      "justification": {
                        "type": "string"
                      },
                      "status": {}
                    },
                    "required": [
                      "id",
                      "status"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/quotesWrites.markAcceptedNative": {
      "post": {
        "operationId": "quotesWrites.markAcceptedNative",
        "summary": "quotesWrites.markAcceptedNative (mutation)",
        "description": "Requires scope: invoice:publish.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "acceptanceRef": {
                        "type": "string"
                      },
                      "acceptedAt": {
                        "type": "number"
                      },
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/quotesWrites.markDeclinedNative": {
      "post": {
        "operationId": "quotesWrites.markDeclinedNative",
        "summary": "quotesWrites.markDeclinedNative (mutation)",
        "description": "Requires scope: invoice:publish.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "reason": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "reason"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/quotesWrites.newVersionNative": {
      "post": {
        "operationId": "quotesWrites.newVersionNative",
        "summary": "quotesWrites.newVersionNative (mutation)",
        "description": "Requires scope: invoice:publish.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/quotesWrites.recallNative": {
      "post": {
        "operationId": "quotesWrites.recallNative",
        "summary": "quotesWrites.recallNative (mutation)",
        "description": "Requires scope: invoice:publish.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "reason": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "reason"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/quotesWrites.sendNative": {
      "post": {
        "operationId": "quotesWrites.sendNative",
        "summary": "quotesWrites.sendNative (mutation)",
        "description": "Requires scope: invoice:publish.",
        "tags": [
          "invoice"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "quoteDate": {
                        "type": "number"
                      },
                      "recipientContactId": {
                        "type": "string"
                      },
                      "validityDays": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "id",
                      "projectId",
                      "quoteDate"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/reservationConflicts.projectConflicts": {
      "post": {
        "operationId": "reservationConflicts.projectConflicts",
        "summary": "reservationConflicts.projectConflicts (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/reservationConflicts.swapCandidates": {
      "post": {
        "operationId": "reservationConflicts.swapCandidates",
        "summary": "reservationConflicts.swapCandidates (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "lineItemId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "lineItemId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/returnsWrites.correctReturnConditionNative": {
      "post": {
        "operationId": "returnsWrites.correctReturnConditionNative",
        "summary": "returnsWrites.correctReturnConditionNative (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "lineItemId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "returnCondition": {},
                      "unitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "lineItemId",
                      "returnCondition"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/returnsWrites.returnBatchNative": {
      "post": {
        "operationId": "returnsWrites.returnBatchNative",
        "summary": "returnsWrites.returnBatchNative (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "batchAuditId": {
                        "type": "string"
                      },
                      "items": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "batchAuditId",
                      "items"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/returnsWrites.returnBulkNative": {
      "post": {
        "operationId": "returnsWrites.returnBulkNative",
        "summary": "returnsWrites.returnBulkNative (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "returnCondition": {}
                    },
                    "required": [
                      "bulkAssetId",
                      "projectId",
                      "quantity",
                      "returnCondition"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/returnsWrites.returnScanNative": {
      "post": {
        "operationId": "returnsWrites.returnScanNative",
        "summary": "returnsWrites.returnScanNative (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "lineItemId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "returnCondition": {}
                    },
                    "required": [
                      "lineItemId",
                      "returnCondition"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/revenueAllocation.recomputeForProject": {
      "post": {
        "operationId": "revenueAllocation.recomputeForProject",
        "summary": "revenueAllocation.recomputeForProject (mutation)",
        "description": "Requires scope: project:manage_line_items.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/savedTableViewsWrites.createNative": {
      "post": {
        "operationId": "savedTableViewsWrites.createNative",
        "summary": "savedTableViewsWrites.createNative (mutation)",
        "description": "Requires scope: self:write.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "config": {},
                      "isDefault": {
                        "type": "boolean"
                      },
                      "name": {
                        "type": "string"
                      },
                      "tableId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "config",
                      "isDefault",
                      "name",
                      "tableId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/savedTableViewsWrites.removeNative": {
      "post": {
        "operationId": "savedTableViewsWrites.removeNative",
        "summary": "savedTableViewsWrites.removeNative (mutation)",
        "description": "Requires scope: self:write.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/savedTableViewsWrites.setDefaultNative": {
      "post": {
        "operationId": "savedTableViewsWrites.setDefaultNative",
        "summary": "savedTableViewsWrites.setDefaultNative (mutation)",
        "description": "Requires scope: self:write.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "tableId": {
                        "type": "string"
                      },
                      "targetId": {}
                    },
                    "required": [
                      "tableId",
                      "targetId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/savedTableViewsWrites.updateNative": {
      "post": {
        "operationId": "savedTableViewsWrites.updateNative",
        "summary": "savedTableViewsWrites.updateNative (mutation)",
        "description": "Requires scope: self:write.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "config": {},
                      "id": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/serviceSchedulesWrites.createNative": {
      "post": {
        "operationId": "serviceSchedulesWrites.createNative",
        "summary": "serviceSchedulesWrites.createNative (mutation)",
        "description": "Requires scope: maintenance:create.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "anchorDate": {
                        "type": "number"
                      },
                      "instructions": {
                        "type": "string"
                      },
                      "intervalMonths": {
                        "type": "number"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "anchorDate",
                      "intervalMonths",
                      "modelId",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/serviceSchedulesWrites.deactivateNative": {
      "post": {
        "operationId": "serviceSchedulesWrites.deactivateNative",
        "summary": "serviceSchedulesWrites.deactivateNative (mutation)",
        "description": "Requires scope: maintenance:delete.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/serviceSchedulesWrites.updateNative": {
      "post": {
        "operationId": "serviceSchedulesWrites.updateNative",
        "summary": "serviceSchedulesWrites.updateNative (mutation)",
        "description": "Requires scope: maintenance:update.",
        "tags": [
          "maintenance"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "anchorDate": {
                        "type": "number"
                      },
                      "id": {
                        "type": "string"
                      },
                      "instructions": {
                        "type": "string"
                      },
                      "intervalMonths": {
                        "type": "number"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "name": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "anchorDate",
                      "id",
                      "intervalMonths",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.addSubHireItemNative": {
      "post": {
        "operationId": "subHiresWrites.addSubHireItemNative",
        "summary": "subHiresWrites.addSubHireItemNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string"
                      },
                      "discount": {
                        "type": "number"
                      },
                      "duration": {
                        "type": "number"
                      },
                      "groupId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "pricingType": {},
                      "quantity": {
                        "type": "number"
                      },
                      "showOnDocs": {
                        "type": "boolean"
                      },
                      "showOnQuote": {
                        "type": "boolean"
                      },
                      "subHireId": {
                        "type": "string"
                      },
                      "targetCategoryId": {
                        "type": "string"
                      },
                      "targetGroupId": {
                        "type": "string"
                      },
                      "unitCharge": {
                        "type": "number"
                      },
                      "unitCost": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "description",
                      "discount",
                      "duration",
                      "pricingType",
                      "quantity",
                      "subHireId",
                      "unitCharge",
                      "unitCost"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.changeSubHireProjectNative": {
      "post": {
        "operationId": "subHiresWrites.changeSubHireProjectNative",
        "summary": "subHiresWrites.changeSubHireProjectNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "newProjectId": {
                        "type": "string"
                      },
                      "subHireId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "newProjectId",
                      "subHireId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.createSubHireGroupNative": {
      "post": {
        "operationId": "subHiresWrites.createSubHireGroupNative",
        "summary": "subHiresWrites.createSubHireGroupNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "charge": {},
                      "cost": {},
                      "discount": {
                        "type": "number"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "showOnDocs": {
                        "type": "boolean"
                      },
                      "showOnQuote": {
                        "type": "boolean"
                      },
                      "sortOrder": {
                        "type": "number"
                      },
                      "subHireId": {
                        "type": "string"
                      },
                      "targetCategoryId": {},
                      "targetGroupId": {},
                      "title": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "subHireId",
                      "title"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.createSubHireNative": {
      "post": {
        "operationId": "subHiresWrites.createSubHireNative",
        "summary": "subHiresWrites.createSubHireNative (mutation)",
        "description": "Requires scope: subHire:create.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "defaultTargetCategoryId": {
                        "type": "string"
                      },
                      "defaultTargetGroupId": {
                        "type": "string"
                      },
                      "hireEnd": {
                        "type": "number"
                      },
                      "hireStart": {
                        "type": "number"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "showOnDocs": {
                        "type": "boolean"
                      },
                      "supplierId": {
                        "type": "string"
                      },
                      "supplierReference": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "showOnDocs",
                      "supplierId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.deleteSubHireGroupNative": {
      "post": {
        "operationId": "subHiresWrites.deleteSubHireGroupNative",
        "summary": "subHiresWrites.deleteSubHireGroupNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "groupId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "groupId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.deleteSubHireNative": {
      "post": {
        "operationId": "subHiresWrites.deleteSubHireNative",
        "summary": "subHiresWrites.deleteSubHireNative (mutation)",
        "description": "Requires scope: subHire:delete.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.duplicateSubHireNative": {
      "post": {
        "operationId": "subHiresWrites.duplicateSubHireNative",
        "summary": "subHiresWrites.duplicateSubHireNative (mutation)",
        "description": "Requires scope: subHire:create.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "sourceId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "sourceId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.linkSubHireToSupplierOrderNative": {
      "post": {
        "operationId": "subHiresWrites.linkSubHireToSupplierOrderNative",
        "summary": "subHiresWrites.linkSubHireToSupplierOrderNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "supplierOrderId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "supplierOrderId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.removeSubHireItemNative": {
      "post": {
        "operationId": "subHiresWrites.removeSubHireItemNative",
        "summary": "subHiresWrites.removeSubHireItemNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "itemId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "itemId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.reorderSubHireItemsNative": {
      "post": {
        "operationId": "subHiresWrites.reorderSubHireItemsNative",
        "summary": "subHiresWrites.reorderSubHireItemsNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "itemIds": {
                        "type": "array"
                      },
                      "subHireId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "itemIds",
                      "subHireId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.setItemGroupNative": {
      "post": {
        "operationId": "subHiresWrites.setItemGroupNative",
        "summary": "subHiresWrites.setItemGroupNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "groupId": {},
                      "itemId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "groupId",
                      "itemId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.unlinkSubHireFromSupplierOrderNative": {
      "post": {
        "operationId": "subHiresWrites.unlinkSubHireFromSupplierOrderNative",
        "summary": "subHiresWrites.unlinkSubHireFromSupplierOrderNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.updateSubHireGroupNative": {
      "post": {
        "operationId": "subHiresWrites.updateSubHireGroupNative",
        "summary": "subHiresWrites.updateSubHireGroupNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "charge": {},
                      "cost": {},
                      "discount": {
                        "type": "number"
                      },
                      "groupId": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "showOnDocs": {
                        "type": "boolean"
                      },
                      "showOnQuote": {
                        "type": "boolean"
                      },
                      "sortOrder": {
                        "type": "number"
                      },
                      "targetCategoryId": {},
                      "targetGroupId": {},
                      "title": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "groupId",
                      "title"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.updateSubHireItemNative": {
      "post": {
        "operationId": "subHiresWrites.updateSubHireItemNative",
        "summary": "subHiresWrites.updateSubHireItemNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string"
                      },
                      "discount": {
                        "type": "number"
                      },
                      "duration": {
                        "type": "number"
                      },
                      "groupId": {
                        "type": "string"
                      },
                      "itemId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "pricingType": {},
                      "quantity": {
                        "type": "number"
                      },
                      "showOnDocs": {
                        "type": "boolean"
                      },
                      "showOnQuote": {
                        "type": "boolean"
                      },
                      "targetCategoryId": {
                        "type": "string"
                      },
                      "targetGroupId": {
                        "type": "string"
                      },
                      "unitCharge": {
                        "type": "number"
                      },
                      "unitCost": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "description",
                      "discount",
                      "duration",
                      "itemId",
                      "pricingType",
                      "quantity",
                      "unitCharge",
                      "unitCost"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.updateSubHireNative": {
      "post": {
        "operationId": "subHiresWrites.updateSubHireNative",
        "summary": "subHiresWrites.updateSubHireNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "defaultTargetCategoryId": {
                        "type": "string"
                      },
                      "defaultTargetGroupId": {
                        "type": "string"
                      },
                      "hireEnd": {
                        "type": "number"
                      },
                      "hireStart": {
                        "type": "number"
                      },
                      "id": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "showOnDocs": {
                        "type": "boolean"
                      },
                      "supplierId": {
                        "type": "string"
                      },
                      "supplierReference": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "showOnDocs",
                      "supplierId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.updateSubHireOrderPricingNative": {
      "post": {
        "operationId": "subHiresWrites.updateSubHireOrderPricingNative",
        "summary": "subHiresWrites.updateSubHireOrderPricingNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "orderTotalCharge": {},
                      "orderTotalCost": {},
                      "pricingMode": {},
                      "subHireId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "pricingMode",
                      "subHireId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.updateSubHirePaymentStatusNative": {
      "post": {
        "operationId": "subHiresWrites.updateSubHirePaymentStatusNative",
        "summary": "subHiresWrites.updateSubHirePaymentStatusNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "paymentStatus": {}
                    },
                    "required": [
                      "id",
                      "paymentStatus"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.updateSubHirePlacementNative": {
      "post": {
        "operationId": "subHiresWrites.updateSubHirePlacementNative",
        "summary": "subHiresWrites.updateSubHirePlacementNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "entityId": {
                        "type": "string"
                      },
                      "entityType": {},
                      "targetCategoryId": {},
                      "targetGroupId": {}
                    },
                    "required": [
                      "entityId",
                      "entityType"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/subHiresWrites.updateSubHireStatusNative": {
      "post": {
        "operationId": "subHiresWrites.updateSubHireStatusNative",
        "summary": "subHiresWrites.updateSubHireStatusNative (mutation)",
        "description": "Requires scope: subHire:update.",
        "tags": [
          "subHire"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "status": {}
                    },
                    "required": [
                      "id",
                      "status"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrderItemsWrites.addSupplierOrderItemNative": {
      "post": {
        "operationId": "supplierOrderItemsWrites.addSupplierOrderItemNative",
        "summary": "supplierOrderItemsWrites.addSupplierOrderItemNative (mutation)",
        "description": "Requires scope: supplier:update.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "orderId": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "unitPrice": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "description",
                      "orderId",
                      "quantity",
                      "unitPrice"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrderItemsWrites.removeSupplierOrderItemNative": {
      "post": {
        "operationId": "supplierOrderItemsWrites.removeSupplierOrderItemNative",
        "summary": "supplierOrderItemsWrites.removeSupplierOrderItemNative (mutation)",
        "description": "Requires scope: supplier:update.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "itemId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "itemId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrderItemsWrites.reorderSupplierOrderItemsNative": {
      "post": {
        "operationId": "supplierOrderItemsWrites.reorderSupplierOrderItemsNative",
        "summary": "supplierOrderItemsWrites.reorderSupplierOrderItemsNative (mutation)",
        "description": "Requires scope: supplier:update.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "itemIds": {
                        "type": "array"
                      },
                      "orderId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "itemIds",
                      "orderId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrderItemsWrites.updateSupplierOrderItemNative": {
      "post": {
        "operationId": "supplierOrderItemsWrites.updateSupplierOrderItemNative",
        "summary": "supplierOrderItemsWrites.updateSupplierOrderItemNative (mutation)",
        "description": "Requires scope: supplier:update.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "itemId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "unitPrice": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "description",
                      "itemId",
                      "quantity",
                      "unitPrice"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrdersWrites.attachInvoiceNative": {
      "post": {
        "operationId": "supplierOrdersWrites.attachInvoiceNative",
        "summary": "supplierOrdersWrites.attachInvoiceNative (mutation)",
        "description": "Requires scope: supplier:update.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "fileId": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "fileId",
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrdersWrites.createNative": {
      "post": {
        "operationId": "supplierOrdersWrites.createNative",
        "summary": "supplierOrdersWrites.createNative (mutation)",
        "description": "Requires scope: supplier:create.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "expectedDate": {
                        "type": "number"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "orderDate": {
                        "type": "number"
                      },
                      "orderNumber": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "receivedDate": {
                        "type": "number"
                      },
                      "status": {},
                      "supplierId": {
                        "type": "string"
                      },
                      "type": {}
                    },
                    "required": [
                      "orderNumber",
                      "supplierId",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrdersWrites.deleteNative": {
      "post": {
        "operationId": "supplierOrdersWrites.deleteNative",
        "summary": "supplierOrdersWrites.deleteNative (mutation)",
        "description": "Requires scope: supplier:delete.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrdersWrites.removeInvoiceNative": {
      "post": {
        "operationId": "supplierOrdersWrites.removeInvoiceNative",
        "summary": "supplierOrdersWrites.removeInvoiceNative (mutation)",
        "description": "Requires scope: supplier:update.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/supplierOrdersWrites.updateNative": {
      "post": {
        "operationId": "supplierOrdersWrites.updateNative",
        "summary": "supplierOrdersWrites.updateNative (mutation)",
        "description": "Requires scope: supplier:update.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "expectedDate": {
                        "type": "number"
                      },
                      "id": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "orderDate": {
                        "type": "number"
                      },
                      "status": {}
                    },
                    "required": [
                      "id",
                      "status"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/suppliersWrites.createNative": {
      "post": {
        "operationId": "suppliersWrites.createNative",
        "summary": "suppliersWrites.createNative (mutation)",
        "description": "Requires scope: supplier:create.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "accountNumber": {
                        "type": "string"
                      },
                      "address": {
                        "type": "string"
                      },
                      "contactName": {
                        "type": "string"
                      },
                      "defaultLeadTime": {
                        "type": "string"
                      },
                      "email": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "latitude": {},
                      "longitude": {},
                      "name": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "paymentTerms": {
                        "type": "string"
                      },
                      "phone": {
                        "type": "string"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "website": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/suppliersWrites.removeNative": {
      "post": {
        "operationId": "suppliersWrites.removeNative",
        "summary": "suppliersWrites.removeNative (mutation)",
        "description": "Requires scope: supplier:delete.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/suppliersWrites.updateNative": {
      "post": {
        "operationId": "suppliersWrites.updateNative",
        "summary": "suppliersWrites.updateNative (mutation)",
        "description": "Requires scope: supplier:update.",
        "tags": [
          "supplier"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "accountNumber": {
                        "type": "string"
                      },
                      "address": {
                        "type": "string"
                      },
                      "contactName": {
                        "type": "string"
                      },
                      "defaultLeadTime": {
                        "type": "string"
                      },
                      "email": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "latitude": {},
                      "longitude": {},
                      "name": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "paymentTerms": {
                        "type": "string"
                      },
                      "phone": {
                        "type": "string"
                      },
                      "tags": {
                        "type": "array"
                      },
                      "website": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testProfilesWrites.createNative": {
      "post": {
        "operationId": "testProfilesWrites.createNative",
        "summary": "testProfilesWrites.createNative (mutation)",
        "description": "Requires scope: testTag:create.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "applianceType": {
                        "type": "string"
                      },
                      "defaultSubTestCount": {
                        "type": "number"
                      },
                      "electricalTests": {},
                      "equipmentClass": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "requiresSubTests": {
                        "type": "boolean"
                      },
                      "subTestLabel": {
                        "type": "string"
                      },
                      "thresholds": {},
                      "visualChecks": {}
                    },
                    "required": [
                      "electricalTests",
                      "name",
                      "thresholds",
                      "visualChecks"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testProfilesWrites.deleteNative": {
      "post": {
        "operationId": "testProfilesWrites.deleteNative",
        "summary": "testProfilesWrites.deleteNative (mutation)",
        "description": "Requires scope: testTag:delete.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testProfilesWrites.duplicateNative": {
      "post": {
        "operationId": "testProfilesWrites.duplicateNative",
        "summary": "testProfilesWrites.duplicateNative (mutation)",
        "description": "Requires scope: testTag:create.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "newId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "newId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testProfilesWrites.seedDefaultsNative": {
      "post": {
        "operationId": "testProfilesWrites.seedDefaultsNative",
        "summary": "testProfilesWrites.seedDefaultsNative (mutation)",
        "description": "Requires scope: testTag:create.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "profiles": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "profiles"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testProfilesWrites.updateNative": {
      "post": {
        "operationId": "testProfilesWrites.updateNative",
        "summary": "testProfilesWrites.updateNative (mutation)",
        "description": "Requires scope: testTag:update.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "applianceType": {
                        "type": "string"
                      },
                      "defaultSubTestCount": {
                        "type": "number"
                      },
                      "electricalTests": {},
                      "equipmentClass": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "name": {
                        "type": "string"
                      },
                      "requiresSubTests": {
                        "type": "boolean"
                      },
                      "subTestLabel": {
                        "type": "string"
                      },
                      "thresholds": {},
                      "visualChecks": {}
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testTagAssetsWrites.backfillNative": {
      "post": {
        "operationId": "testTagAssetsWrites.backfillNative",
        "summary": "testTagAssetsWrites.backfillNative (mutation)",
        "description": "Requires scope: testTag:create.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testTagAssetsWrites.createFromBulkNative": {
      "post": {
        "operationId": "testTagAssetsWrites.createFromBulkNative",
        "summary": "testTagAssetsWrites.createFromBulkNative (mutation)",
        "description": "Requires scope: testTag:create.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "applianceType": {},
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "equipmentClass": {},
                      "ids": {
                        "type": "array"
                      },
                      "location": {
                        "type": "string"
                      },
                      "make": {
                        "type": "string"
                      },
                      "modelName": {
                        "type": "string"
                      },
                      "testIntervalMonths": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "bulkAssetId",
                      "description",
                      "ids"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testTagAssetsWrites.createNative": {
      "post": {
        "operationId": "testTagAssetsWrites.createNative",
        "summary": "testTagAssetsWrites.createNative (mutation)",
        "description": "Requires scope: testTag:create.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "applianceType": {},
                      "assetId": {
                        "type": "string"
                      },
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "description": {
                        "type": "string"
                      },
                      "equipmentClass": {},
                      "location": {
                        "type": "string"
                      },
                      "make": {
                        "type": "string"
                      },
                      "modelName": {
                        "type": "string"
                      },
                      "notes": {
                        "type": "string"
                      },
                      "outletCount": {
                        "type": "number"
                      },
                      "serialNumber": {
                        "type": "string"
                      },
                      "testIntervalMonths": {
                        "type": "number"
                      },
                      "testProfileId": {
                        "type": "string"
                      },
                      "testTagId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "description"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testTagAssetsWrites.deleteNative": {
      "post": {
        "operationId": "testTagAssetsWrites.deleteNative",
        "summary": "testTagAssetsWrites.deleteNative (mutation)",
        "description": "Requires scope: testTag:delete.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testTagAssetsWrites.reactivateNative": {
      "post": {
        "operationId": "testTagAssetsWrites.reactivateNative",
        "summary": "testTagAssetsWrites.reactivateNative (mutation)",
        "description": "Requires scope: testTag:update.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testTagAssetsWrites.retireNative": {
      "post": {
        "operationId": "testTagAssetsWrites.retireNative",
        "summary": "testTagAssetsWrites.retireNative (mutation)",
        "description": "Requires scope: testTag:update.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testTagAssetsWrites.updateNative": {
      "post": {
        "operationId": "testTagAssetsWrites.updateNative",
        "summary": "testTagAssetsWrites.updateNative (mutation)",
        "description": "Requires scope: testTag:update.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "patch": {
                        "type": "object"
                      }
                    },
                    "required": [
                      "id",
                      "patch"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/testTagRecordsWrites.createNative": {
      "post": {
        "operationId": "testTagRecordsWrites.createNative",
        "summary": "testTagRecordsWrites.createNative (mutation)",
        "description": "Requires scope: testTag:create.",
        "tags": [
          "testTag"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "earthContinuityReading": {
                        "type": "number"
                      },
                      "earthContinuityResult": {},
                      "equipmentClassTested": {},
                      "failureAction": {},
                      "failureNotes": {
                        "type": "string"
                      },
                      "functionalTestNotes": {
                        "type": "string"
                      },
                      "functionalTestResult": {},
                      "insulationReading": {
                        "type": "number"
                      },
                      "insulationResult": {},
                      "insulationTestVoltage": {
                        "type": "number"
                      },
                      "leakageCurrentReading": {
                        "type": "number"
                      },
                      "leakageCurrentResult": {},
                      "maintenanceId": {
                        "type": "string"
                      },
                      "maintenanceLinkId": {
                        "type": "string"
                      },
                      "nextDueDate": {
                        "type": "number"
                      },
                      "outletCount": {
                        "type": "number"
                      },
                      "polarityResult": {},
                      "rcdTripTimeReading": {
                        "type": "number"
                      },
                      "rcdTripTimeResult": {},
                      "recordId": {
                        "type": "string"
                      },
                      "result": {},
                      "subTests": {
                        "type": "array"
                      },
                      "testDate": {
                        "type": "number"
                      },
                      "testedById": {
                        "type": "string"
                      },
                      "testerName": {
                        "type": "string"
                      },
                      "testMethod": {},
                      "testProfileId": {
                        "type": "string"
                      },
                      "testTagAssetId": {
                        "type": "string"
                      },
                      "visualCordCondition": {
                        "type": "boolean"
                      },
                      "visualCordGrip": {
                        "type": "boolean"
                      },
                      "visualEarthPin": {
                        "type": "boolean"
                      },
                      "visualHousingCondition": {
                        "type": "boolean"
                      },
                      "visualInspectionResult": {},
                      "visualMarkingsLegible": {
                        "type": "boolean"
                      },
                      "visualNoModifications": {
                        "type": "boolean"
                      },
                      "visualNotes": {
                        "type": "string"
                      },
                      "visualPlugCondition": {
                        "type": "boolean"
                      },
                      "visualSwitchCondition": {
                        "type": "boolean"
                      },
                      "visualVentsUnobstructed": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "nextDueDate",
                      "recordId",
                      "result",
                      "testDate",
                      "testerName",
                      "testTagAssetId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/userNotificationPreferences.mine": {
      "post": {
        "operationId": "userNotificationPreferences.mine",
        "summary": "userNotificationPreferences.mine (query)",
        "description": "Requires scope: self:read.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/userNotificationPreferences.upsertMine": {
      "post": {
        "operationId": "userNotificationPreferences.upsertMine",
        "summary": "userNotificationPreferences.upsertMine (mutation)",
        "description": "Requires scope: self:write.",
        "tags": [
          "self"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "prefs": {
                        "type": "object"
                      }
                    },
                    "required": [
                      "id",
                      "prefs"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseCloses.closeOutSummary": {
      "post": {
        "operationId": "warehouseCloses.closeOutSummary",
        "summary": "warehouseCloses.closeOutSummary (query)",
        "description": "Requires scope: warehouse:close.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseCloses.getById": {
      "post": {
        "operationId": "warehouseCloses.getById",
        "summary": "warehouseCloses.getById (query)",
        "description": "Requires scope: warehouse:read.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseCloses.getByProject": {
      "post": {
        "operationId": "warehouseCloses.getByProject",
        "summary": "warehouseCloses.getByProject (query)",
        "description": "Requires scope: warehouse:read.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseCloseWrites.batchCloseOutNative": {
      "post": {
        "operationId": "warehouseCloseWrites.batchCloseOutNative",
        "summary": "warehouseCloseWrites.batchCloseOutNative (mutation)",
        "description": "Requires scope: warehouse:close.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "batchAuditId": {
                        "type": "string"
                      },
                      "items": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "batchAuditId",
                      "items"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseCloseWrites.closeOutNative": {
      "post": {
        "operationId": "warehouseCloseWrites.closeOutNative",
        "summary": "warehouseCloseWrites.closeOutNative (mutation)",
        "description": "Requires scope: warehouse:close.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseDetail.bundle": {
      "post": {
        "operationId": "warehouseDetail.bundle",
        "summary": "warehouseDetail.bundle (query)",
        "description": "Requires scope: project:read.",
        "tags": [
          "project"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseList.bundle": {
      "post": {
        "operationId": "warehouseList.bundle",
        "summary": "warehouseList.bundle (query)",
        "description": "Requires scope: warehouse:read.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseReturns.bundle": {
      "post": {
        "operationId": "warehouseReturns.bundle",
        "summary": "warehouseReturns.bundle (query)",
        "description": "Requires scope: warehouse:read.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseReturns.unitsForLine": {
      "post": {
        "operationId": "warehouseReturns.unitsForLine",
        "summary": "warehouseReturns.unitsForLine (query)",
        "description": "Requires scope: warehouse:read.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "lineItemId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "lineItemId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "args"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.bulkForceReturnAssets": {
      "post": {
        "operationId": "warehouseWrites.bulkForceReturnAssets",
        "summary": "warehouseWrites.bulkForceReturnAssets (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "assetIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.checkInItems": {
      "post": {
        "operationId": "warehouseWrites.checkInItems",
        "summary": "warehouseWrites.checkInItems (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "auditIds": {
                        "type": "array"
                      },
                      "items": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "auditIds",
                      "items",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.checkInKit": {
      "post": {
        "operationId": "warehouseWrites.checkInKit",
        "summary": "warehouseWrites.checkInKit (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "returnCondition": {}
                    },
                    "required": [
                      "kitId",
                      "projectId",
                      "returnCondition"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.checkInKitsBatch": {
      "post": {
        "operationId": "warehouseWrites.checkInKitsBatch",
        "summary": "warehouseWrites.checkInKitsBatch (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "items": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "items",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.checkOutItems": {
      "post": {
        "operationId": "warehouseWrites.checkOutItems",
        "summary": "warehouseWrites.checkOutItems (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "auditIds": {
                        "type": "array"
                      },
                      "includeAccessories": {
                        "type": "boolean"
                      },
                      "items": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "auditIds",
                      "includeAccessories",
                      "items",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.checkOutKit": {
      "post": {
        "operationId": "warehouseWrites.checkOutKit",
        "summary": "warehouseWrites.checkOutKit (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kitId",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.checkOutKitsBatch": {
      "post": {
        "operationId": "warehouseWrites.checkOutKitsBatch",
        "summary": "warehouseWrites.checkOutKitsBatch (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "auditIds": {
                        "type": "array"
                      },
                      "kitIds": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "auditIds",
                      "kitIds",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.clearPrepContainer": {
      "post": {
        "operationId": "warehouseWrites.clearPrepContainer",
        "summary": "warehouseWrites.clearPrepContainer (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "containerName": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "containerName",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.ensureContainerOnProject": {
      "post": {
        "operationId": "warehouseWrites.ensureContainerOnProject",
        "summary": "warehouseWrites.ensureContainerOnProject (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "containerName": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "assetId",
                      "containerName",
                      "modelId",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.forceReturnAsset": {
      "post": {
        "operationId": "warehouseWrites.forceReturnAsset",
        "summary": "warehouseWrites.forceReturnAsset (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "assetId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.forceReturnKit": {
      "post": {
        "operationId": "warehouseWrites.forceReturnKit",
        "summary": "warehouseWrites.forceReturnKit (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.forceReturnKits": {
      "post": {
        "operationId": "warehouseWrites.forceReturnKits",
        "summary": "warehouseWrites.forceReturnKits (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitIds": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "kitIds"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.logAccessoryCheckoutOverride": {
      "post": {
        "operationId": "warehouseWrites.logAccessoryCheckoutOverride",
        "summary": "warehouseWrites.logAccessoryCheckoutOverride (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "parentName": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "skipped": {
                        "type": "array"
                      }
                    },
                    "required": [
                      "parentName",
                      "projectId",
                      "skipped"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.quickAddAndCheckOut": {
      "post": {
        "operationId": "warehouseWrites.quickAddAndCheckOut",
        "summary": "warehouseWrites.quickAddAndCheckOut (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "assetId": {
                        "type": "string"
                      },
                      "bulkAssetId": {
                        "type": "string"
                      },
                      "modelId": {
                        "type": "string"
                      },
                      "prepContainer": {},
                      "projectId": {
                        "type": "string"
                      },
                      "quantity": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "modelId",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.reassignKitMemberSerial": {
      "post": {
        "operationId": "warehouseWrites.reassignKitMemberSerial",
        "summary": "warehouseWrites.reassignKitMemberSerial (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "newAssetId": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "unitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "newAssetId",
                      "projectId",
                      "unitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.reassignLineItemUnit": {
      "post": {
        "operationId": "warehouseWrites.reassignLineItemUnit",
        "summary": "warehouseWrites.reassignLineItemUnit (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string"
                      },
                      "targetLineItemId": {
                        "type": "string"
                      },
                      "unitId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "projectId",
                      "targetLineItemId",
                      "unitId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.syncContainersBatch": {
      "post": {
        "operationId": "warehouseWrites.syncContainersBatch",
        "summary": "warehouseWrites.syncContainersBatch (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "containerNames": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "containerNames",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.undeployItems": {
      "post": {
        "operationId": "warehouseWrites.undeployItems",
        "summary": "warehouseWrites.undeployItems (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "auditIds": {
                        "type": "array"
                      },
                      "items": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "auditIds",
                      "items",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.undeployKit": {
      "post": {
        "operationId": "warehouseWrites.undeployKit",
        "summary": "warehouseWrites.undeployKit (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kitId",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.undeployKitsBatch": {
      "post": {
        "operationId": "warehouseWrites.undeployKitsBatch",
        "summary": "warehouseWrites.undeployKitsBatch (mutation)",
        "description": "Requires scope: warehouse:check_in.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitIds": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kitIds",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.undeprepLine": {
      "post": {
        "operationId": "warehouseWrites.undeprepLine",
        "summary": "warehouseWrites.undeprepLine (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "lineItemId": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "lineItemId",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.unreturnItems": {
      "post": {
        "operationId": "warehouseWrites.unreturnItems",
        "summary": "warehouseWrites.unreturnItems (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "auditIds": {
                        "type": "array"
                      },
                      "items": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "auditIds",
                      "items",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.unreturnKit": {
      "post": {
        "operationId": "warehouseWrites.unreturnKit",
        "summary": "warehouseWrites.unreturnKit (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitId": {
                        "type": "string"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kitId",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/ops/warehouseWrites.unreturnKitsBatch": {
      "post": {
        "operationId": "warehouseWrites.unreturnKitsBatch",
        "summary": "warehouseWrites.unreturnKitsBatch (mutation)",
        "description": "Requires scope: warehouse:check_out.",
        "tags": [
          "warehouse"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "args": {
                    "type": "object",
                    "properties": {
                      "kitIds": {
                        "type": "array"
                      },
                      "projectId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kitIds",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  "idempotencyKey": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 200,
                    "description": "Required for mutations. A retry with the same key replays the first result instead of double-writing."
                  }
                },
                "required": [
                  "args",
                  "idempotencyKey"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success (read, or a replayed write).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "201": {
            "description": "Success (a write took effect).",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SuccessEnvelope"
                }
              }
            }
          },
          "default": {
            "description": "Error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          }
        }
      }
    }
  }
} as const;
