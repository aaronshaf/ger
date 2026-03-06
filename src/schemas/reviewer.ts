import { Schema } from '@effect/schema'

export const ReviewerListItem: Schema.Schema<{
  readonly _account_id?: number
  readonly name?: string
  readonly email?: string
  readonly username?: string
  readonly approvals?: { readonly [x: string]: string }
}> = Schema.Struct({
  _account_id: Schema.optional(Schema.Number),
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  approvals: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})
export type ReviewerListItem = Schema.Schema.Type<typeof ReviewerListItem>
