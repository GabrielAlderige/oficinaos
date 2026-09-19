-- Tirar um item da OS não pode esbarrar na história que aponta para ele.
--
-- O orçamento enviado, a compra, a cotação com fornecedor e a foto guardam
-- uma cópia própria do que interessa (descrição, preço, quantidade): o link
-- para o item é só um ponteiro. Quando a oficina reabre a OS e remove o item,
-- o ponteiro vira null e o histórico continua de pé — antes disso o DELETE
-- estourava erro de chave estrangeira e a tela dava 500.
--
-- `set null (work_order_item_id)` (Postgres 15+) zera SÓ essa coluna: a
-- organization_id da chave composta é `not null` e continua onde está.

alter table quote_items alter column work_order_item_id drop not null;

alter table quote_items drop constraint quote_items_work_order_item_fk;
alter table quote_items add constraint quote_items_work_order_item_fk
  foreign key (organization_id, work_order_item_id)
  references work_order_items (organization_id, id)
  on delete set null (work_order_item_id);

alter table purchase_order_items drop constraint purchase_order_items_work_order_item_fk;
alter table purchase_order_items add constraint purchase_order_items_work_order_item_fk
  foreign key (organization_id, work_order_item_id)
  references work_order_items (organization_id, id)
  on delete set null (work_order_item_id);

alter table supplier_quote_request_items drop constraint supplier_quote_request_items_work_order_item_fk;
alter table supplier_quote_request_items add constraint supplier_quote_request_items_work_order_item_fk
  foreign key (organization_id, work_order_item_id)
  references work_order_items (organization_id, id)
  on delete set null (work_order_item_id);

alter table attachments drop constraint attachments_work_order_item_fk;
alter table attachments add constraint attachments_work_order_item_fk
  foreign key (organization_id, work_order_item_id)
  references work_order_items (organization_id, id)
  on delete set null (work_order_item_id);
