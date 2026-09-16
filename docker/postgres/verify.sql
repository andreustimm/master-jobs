\set ON_ERROR_STOP on

SELECT current_setting('server_version') AS server_version;

SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pgmq', 'vector')
ORDER BY extname;

SELECT queue_name, is_partitioned
FROM pgmq.list_queues()
ORDER BY queue_name;
