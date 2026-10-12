-- Keeps Message."searchVector" in step with Message."body".
--
-- Why a trigger rather than a GENERATED ALWAYS AS STORED column: Prisma cannot
-- express a generated column, so it would introspect as drift and block
-- `prisma migrate dev` on the next schema change. Triggers are invisible to
-- Prisma's drift detection, so this keeps the column Prisma-managed (declared
-- in schema.prisma as Unsupported("tsvector")) while still maintaining itself.
--
-- 'english' is hardcoded to match the configuration used by the query in
-- src/app/api/workspaces/[workspaceId]/search/route.ts. The two must agree or
-- the index will not be used.

CREATE OR REPLACE FUNCTION thrum_message_search_vector()
RETURNS trigger
LANGUAGE plpgsql
-- No search_path dependency and no dynamic SQL, so this is safe to run with the
-- definer's rights; pinning search_path keeps it that way.
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english', COALESCE(NEW."body", ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "message_search_vector_trigger" ON "Message";

CREATE TRIGGER "message_search_vector_trigger"
  BEFORE INSERT OR UPDATE OF "body"
  ON "Message"
  FOR EACH ROW
  EXECUTE FUNCTION thrum_message_search_vector();

-- Backfill rows that existed before the trigger.
UPDATE "Message"
   SET "searchVector" = to_tsvector('english', COALESCE("body", ''))
 WHERE "searchVector" IS NULL;
