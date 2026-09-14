ALTER TABLE "supplier_quote_awards" DROP CONSTRAINT "supplier_quote_awards_requestItemId_unique";--> statement-breakpoint
ALTER TABLE "supplier_quote_invites" DROP CONSTRAINT "supplier_quote_invites_tokenHash_unique";--> statement-breakpoint
ALTER TABLE "supplier_quote_awards" ADD CONSTRAINT "supplier_quote_awards_request_item_unique" UNIQUE("request_item_id");--> statement-breakpoint
ALTER TABLE "supplier_quote_invites" ADD CONSTRAINT "supplier_quote_invites_token_hash_unique" UNIQUE("token_hash");