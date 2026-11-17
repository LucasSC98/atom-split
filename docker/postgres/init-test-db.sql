SELECT 'CREATE DATABASE split_payments_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'split_payments_test')\gexec
