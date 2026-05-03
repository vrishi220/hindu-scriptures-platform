SELECT current_database(), current_schema(), current_user;
SELECT
has_table_privilege(current_user, 'public.users', 'SELECT') AS can_read_users,
has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public;

