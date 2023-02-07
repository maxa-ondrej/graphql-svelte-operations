import { PluginFunction, Types } from "@graphql-codegen/plugin-helpers";

import {
  GraphQLSchema,
  isNullableType,
  isNonNullType,
  assertNonNullType,
  isListType,
  assertListType,
  isScalarType,
  type GraphQLArgument,
  type GraphQLInputType,
  type GraphQLOutputType,
  GraphQLType,
} from "graphql";

export function create_variables(args: readonly GraphQLArgument[]) {
  if (args.length === 0) return "undefined";
  return (
    "{" +
    args
      .map(
        (arg) =>
          `"${arg.name}"${isNullableType(arg.type) ? "?" : ""}: ${get_type(
            arg.type
          )}`
      )
      .join(",") +
    "}"
  );
}

export function create_variables_array(args: readonly GraphQLArgument[]) {
  if (args.length === 0) return "{}";
  return (
    "{" + args.map((arg) => `"${arg.name}": "${arg.type}"`).join(",") + "}"
  );
}

export function get_type(
  gql: GraphQLType | GraphQLInputType | GraphQLOutputType,
  nil = true
) {
  if (nil && isNullableType(gql)) {
    return `Types.Maybe<${get_type(gql, false)}>`;
  }
  if (nil && isNonNullType(gql)) {
    return get_type(assertNonNullType(gql).ofType, false);
  }
  if (isListType(gql)) {
    return get_type(assertListType(gql).ofType) + "[]";
  }
  if (isScalarType(gql)) {
    return `Types.Scalars['${gql}']`;
  }
  return `Types.${gql}`;
}

export type SvelteOperationsPluginConfig = {
  types: string;
};

export const plugin: PluginFunction<SvelteOperationsPluginConfig, string> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: SvelteOperationsPluginConfig
) => {
  const typesPath = config.types;
  let result = `import type * as Types from '${typesPath}';
type Query<R = object | null, V = object> = { R: R; V?: V };
type Mutation<R = object | null, V = object> = { R: R; V?: V };

export function query<Q extends Query>(variables: Q['V'] = undefined) {
return new Promise<Q['R']>((r) => r({} as Q['R']));
}

export function mutation<Q extends Query>(variables: Q['V'] = undefined) {
return new Promise<Q['R']>((r) => r({} as Q['R']));
}
`;
  const queryType = schema.getQueryType();
  if (queryType !== undefined && queryType !== null)
    Object.values(queryType.getFields()).forEach((query) => {
      const name = query.name;
      result += `
export type ${name} = Query<${get_type(query.type)}, ${create_variables(
        query.args
      )}>;
export const ${name}__variables = ${create_variables_array(query.args)};
`;
    });

  const mutationType = schema.getMutationType();
  if (mutationType !== undefined && mutationType !== null)
    Object.values(mutationType.getFields()).forEach((mutation) => {
      const name = mutation.name;
      result += `
export type ${name} = Mutation<${get_type(mutation.type)}, ${create_variables(
        mutation.args
      )}>;
export const ${name}__variables = ${create_variables_array(mutation.args)};
`;
    });

  return result;
};
