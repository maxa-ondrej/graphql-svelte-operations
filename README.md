<h1>GraphQL processor for SvelteKit</h1>

---

**Version:** 1.0.0-beta.12

This is a [SvelteKit](https://kit.svelte.dev/) adapter that allows you to use [GraphQL](https://graphql.org/) operations easily in your SvelteKit app.

Please keep in mind that GraphQL processor for SvelteKit is still under active development and full backward compatibility is not guaranteed before reaching v1.0.0.

## Summary

- [Summary](#summary)
- [Sponsor](#sponsor)
- [Installation](#installation)
- [Prerequisites](#prerequisites)
- [Introduction](#introduction)
- [Usage](#usage)
  - [Example without variables](#example-without-variables)
  - [Example with variables](#example-with-variables)
  - [Example with additional settings](#example-with-additional-settings)
- [Warnings](#warnings)
- [Configuration](#configuration)
  - [Urql](#urql)
  - [SvelteKit](#sveltekit)
  - [Codegen](#codegen)

## Sponsor

This project is sponsored by and contributed to by [Green Panda s.r.o](https://greenpanda.cz/).

## Installation

```bash
npm install --save-dev @majksa/svelte-operations@1.0.0-beta.12
# or
yarn add --dev @majksa/svelte-operations@1.0.0-beta.12
# or
pnpm add --save-dev @majksa/svelte-operations@1.0.0-beta.12
```

## Prerequisites

This adapter requires you to have [GraphQL Code Generator](https://graphql-code-generator.com/) installed in your project.
You also need to have urql for svelte and graphql installed in your project.
You can install all of the above with the following command:

```bash
npm install --save-dev @graphql-codegen/cli @urlq/svelte graphql
# or
yarn add --dev @graphql-codegen/cli @urlq/svelte graphql
# or
pnpm add --save-dev @graphql-codegen/cli @urlq/svelte graphql
```

## Introduction

GraphQL processor for SvelteKit allows you to use GraphQL operations in your SvelteKit app. It uses GraphQL Code Generator to generate TypeScript types for your GraphQL operations and SvelteKit preprocessor to generate GraphQL queries from your GraphQL operations.

It is fully typed and requires TypeScript to work correctly.
All calls are completely asynchronous and you can use them in your SvelteKit components and routes.

Preprocessor will automatically scan your code and generate a query depending on the fields you are accessing. If you need to query a field that is not being accessed, you need to pass it in the second argument of the operation call.

## Usage

You can use GraphQL operations in your SvelteKit app by importing them and using them in your components. You can also use GraphQL operations in your SvelteKit routes.

### Example without variables

```svelte
<script lang="ts">
  import { ListPosts } from "$lib/queries";

  const posts = ListPosts();
</script>

{#await posts}
  <p>Loading...</p>
{:then posts}
  {#each posts as post}
    <p>{post.title}</p>
  {/each}
{/await}
```

### Example with variables

```svelte
<script lang="ts">
  import { GetPost } from "$lib/queries";

  const post = GetPost({
    post: {
      id: 1,
    }
  });
</script>

{#await post}
  <p>Loading...</p>
{:then post}
  {#if post}
    <p>{post.title}</p>
  {:else}
    <p>Post not found</p>
  {/if}
{/await}
```

### Example with additional settings

```svelte
<script lang="ts">
  import { GetPost } from "$lib/queries";

  GetPost({
    post: {
      id: 1,
    }
  }, {
    fields: ["title", "content", "author.name"],
  }).then((post) => {
    console.log(post);
  });
</script>
```

## Warnings

- You can only use GraphQL operations in SvelteKit components and routes. You can't use them in other files.
- Preprocessors currently supports only queries and mutations. Subscriptions are not supported yet.
- When calling generated operations you cannot type any `)` character. This is because the preprocessor will think the function call is finished and will not generate the query.
- Preproccessor currently only queries fields that are accessed in the markup part.
- Preprocessor currently does not work in the very root +layout.svelte file. You need to use it in a child component.

## Configuration

First you need to decide where you want to store your GraphQL operations. You can store them in a separate directory or in the same directory as your components. The only requirement is that you need to be able to import them from your SvelteKit app.
You also need to decide whether you want to store your queries and mutations in separate files or in the same file. You can store them in the same file if you don't have many queries and mutations and all queries and mutations have unique names. Otherwise it is recommended to store them in separate files.

You also need to decide where you want to store your GraphQL schema types. The only requirement is that you need to be able to import it from your SvelteKit app.

In the following example we will store our GraphQL queries in `$lib/queries`, mutations in `$lib/mutations` and schema types `$type/graphql`.

### Urql

You need to configure urql to use your GraphQL operations. You shoud do this in your `routes/+layout.svelte` file. You can do this by adding the following configuration:

```svelte
<script lang="ts">
  import { initContextClient } from '@urql/svelte';

  initContextClient({
    url: '/graphql',
    fetchOptions: {
      credentials: 'include',
      mode: 'cors'
    }
  });
</script>
```

More information about configuring urql can be found in the [urql documentation](https://formidable.com/open-source/urql/docs/).

### SvelteKit

You need to configure SvelteKit to preprocess your GraphQL operations. You can do this by creating a `svelte.config.js` file in the root of your project and adding the following configuration:

```js
// svelte.config.js
import { graphqlPreprocess } from "@majksa/svelte-operations";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [
    graphqlPreprocess({
      queries: "$lib/queries",
      mutations: "$lib/mutations",
    }),
  ],
  kit: {
    // ... your SvelteKit configuration
    alias: {
      $type: "./src/types",
    },
  },
};

export default config;
```

### Codegen

You need to configure GraphQL Code Generator to generate TypeScript types for your GraphQL operations. You can do this by creating a `codegen.yml` file in the root of your project and adding the following configuration:

```yml
overwrite: true
schema: "schema.graphql"
generates:
  src/types/graphql.ts:
    plugins:
      - add:
          content: ["// THIS FILE IS GENERATED, DO NOT EDIT!"]
      - typescript
  src/lib/queries.ts:
    plugins:
      - add:
          content: ["// THIS FILE IS GENERATED, DO NOT EDIT!"]
      - "@majksa/svelte-operations":
          queries: true
          types: "$type/graphql"

  src/lib/mutations.ts:
    plugins:
      - add:
          content: ["// THIS FILE IS GENERATED, DO NOT EDIT!"]
      - "@majksa/svelte-operations":
          mutations: true
          types: "$type/graphql"

config:
  useTypeImports: true
  enumsAsTypes: true
  omitOperationSuffix: true
  dedupeOperationSuffix: true
  exportFragmentSpreadSubTypes: true
  experimentalFragmentVariables: true
  addUnderscoreToArgsType: true
  preResolveTypes: true
  namingConvention: keep
  scalars:
    Date: string
    DateTime: string
```

The code generator will also import your GraphQL schema types as `Types` and additional options type as `Options`.
You can change those aliases by adding the following configuration:

```yml
generates:
  src/lib/queries.ts:
    plugins:
      - "@majksa/svelte-operations":
          queries: true
          types: "$type/graphql"
          typesAlias: "Types"
          optionsAlias: "Options"
```
