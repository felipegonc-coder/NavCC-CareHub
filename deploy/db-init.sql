-- Creates the app's own PostgreSQL role (docker-compose.yml mounts this file into
-- /docker-entrypoint-initdb.d). It runs once, as the superuser POSTGRES_USER, when the db
-- service sets up an empty postgres/ folder. The role logs in with CAREHUB_DB_PASSWORD,
-- isn't a superuser, can't create databases or roles, and owns the Care Hub database, so the
-- app's migrations can create its tables. Backups and restores use the superuser.
\getenv app_user CAREHUB_DB_USER
\getenv app_password CAREHUB_DB_PASSWORD
\getenv db POSTGRES_DB
CREATE ROLE :"app_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'app_password';
ALTER DATABASE :"db" OWNER TO :"app_user";
