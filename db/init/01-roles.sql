-- Roles do Postgres local do Rondo.
--
-- `rondo_migrator` é o usuário do container (dono do schema e das migrations, DDL).
-- `rondo_app` é o usuário da API (DML nas tabelas e `execute` nas funções SQL).
-- As credenciais `rondo`/`rondo` são só de desenvolvimento local: nunca use em produção.
--
-- Este arquivo roda apenas na criação do volume (`docker-entrypoint-initdb.d`).
-- As migrations também concedem privilégios explícitos, então `bun run db:migrate`
-- cobre bancos cujo volume já existia.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rondo_app') then
    create role rondo_app login password 'rondo';
  end if;
end
$$;

grant connect on database rondo to rondo_app;

-- Acesso somente leitura às views de estatística usadas pelo receiver `postgresql`
-- do OTel Collector (nenhum acesso a dados de tabela é concedido por este grant).
grant pg_monitor to rondo_app;

grant usage on schema public to rondo_app;

-- Tabelas e sequências criadas pelo `rondo_migrator` no futuro já nascem
-- acessíveis ao `rondo_app`, sem depender de um grant manual.
alter default privileges in schema public
  grant select, insert, update, delete on tables to rondo_app;

alter default privileges in schema public
  grant usage, select on sequences to rondo_app;
