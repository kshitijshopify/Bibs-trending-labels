// Every GraphQL operation used by the integration (Admin API 2026-10).
// Operation names are prefixed "Bbl" so logs and test fakes can identify them.

/** Every status, because the products query defaults to ACTIVE only. */
export const ALL_STATUSES_QUERY = "status:active,archived,draft,unlisted";

export const SHOP_INFO = `#graphql
  query BblShopInfo {
    shop {
      name
      myshopifyDomain
      ianaTimezone
      currencyCode
      plan {
        shopifyPlus
        partnerDevelopment
        publicDisplayName
      }
    }
  }`;

export const PRODUCTS_COUNT = `#graphql
  query BblProductsCount($query: String) {
    productsCount(query: $query, limit: null) {
      count
      precision
    }
  }`;

/** Inner query for the bulk export: one JSONL line per product, no nesting. */
export const CATALOG_BULK_QUERY = `{
  products(query: "${ALL_STATUSES_QUERY}") {
    edges {
      node {
        id
        legacyResourceId
        title
        status
        productType
        tags
      }
    }
  }
}`;

export const BULK_RUN_QUERY = `#graphql
  mutation BblStartCatalogExport($query: String!) {
    bulkOperationRunQuery(query: $query, groupObjects: false) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

export const BULK_OPERATION_STATUS = `#graphql
  query BblBulkOperation($id: ID!) {
    bulkOperation(id: $id) {
      id
      status
      errorCode
      objectCount
      rootObjectCount
      fileSize
      url
      partialDataUrl
      createdAt
      completedAt
    }
  }`;

export const SHOPIFYQL_QUERY = `#graphql
  query BblShopifyql($query: String!) {
    shopifyqlQuery(query: $query) {
      tableData {
        columns {
          name
          dataType
          displayName
        }
        rows
      }
      parseErrors
      parseWarnings
    }
  }`;

export const FLOW_TRIGGER_RECEIVE = `#graphql
  mutation BblFlowTrigger($handle: String, $payload: JSON) {
    flowTriggerReceive(handle: $handle, payload: $payload) {
      userErrors {
        field
        message
      }
    }
  }`;

export const PRODUCT_FOR_APPLY = `#graphql
  query BblProductForApply($id: ID!) {
    product(id: $id) {
      id
      legacyResourceId
      title
      status
      productType
      tags
    }
  }`;

export const TAGS_ADD = `#graphql
  mutation BblTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
        ... on Product {
          tags
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;

export const TAGS_REMOVE = `#graphql
  mutation BblTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
        ... on Product {
          tags
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;

/** Mutations that change products. Preview runs must never send any of these. */
export const PRODUCT_CHANGING_OPERATIONS = ["BblTagsAdd", "BblTagsRemove"];

export function operationName(query) {
  const match = /\b(?:query|mutation)\s+(\w+)/.exec(query);
  return match ? match[1] : "anonymous";
}
