-- Schema-only fixture from the existing platform; no records or credentials.
CREATE TYPE public.device_status_type AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'REVOKED',
    'EXPIRED',
    'BLACKLISTED'
);

CREATE TABLE public.admin_roles (
    id integer NOT NULL,
    role_code character varying(40) NOT NULL,
    role_name character varying(120) NOT NULL,
    permissions jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);

CREATE SEQUENCE public.admin_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.admin_roles_id_seq OWNED BY public.admin_roles.id;

CREATE TABLE public.admin_users (
    id integer NOT NULL,
    full_name character varying(120) NOT NULL,
    email character varying(180) NOT NULL,
    password_hash text NOT NULL,
    role_code character varying(40) NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);

CREATE SEQUENCE public.admin_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.admin_users_id_seq OWNED BY public.admin_users.id;

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    actor text,
    action text,
    payload jsonb,
    created_at timestamp without time zone DEFAULT now()
);

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;

CREATE TABLE public.certificate_records (
    id integer NOT NULL,
    device_id character varying(16) NOT NULL,
    certificate_hash text NOT NULL,
    signature text NOT NULL,
    issued_at bigint NOT NULL,
    expiry_at bigint NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    revoked_at bigint,
    revoked_reason text,
    replaced_by text,
    created_at timestamp without time zone DEFAULT now(),
    public_key text,
    issuer_id text,
    certificate_body jsonb,
    root_ca_version text DEFAULT 'v1'::text
);

CREATE SEQUENCE public.certificate_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.certificate_records_id_seq OWNED BY public.certificate_records.id;

CREATE TABLE public.customers (
    id integer NOT NULL,
    customer_id text NOT NULL,
    full_name text,
    phone text,
    email text,
    status text DEFAULT 'active'::text,
    created_at timestamp without time zone DEFAULT now(),
    alias text,
    node_address text
);

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;

CREATE TABLE public.device_key_history (
    id bigint NOT NULL,
    device_id character varying(16) NOT NULL,
    old_public_key text,
    new_public_key text NOT NULL,
    rotated_at timestamp without time zone DEFAULT now(),
    rotated_by text
);

CREATE SEQUENCE public.device_key_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.device_key_history_id_seq OWNED BY public.device_key_history.id;

CREATE TABLE public.device_registry (
    id integer NOT NULL,
    device_id character varying(16) NOT NULL,
    alias text,
    issuer_id text,
    deployment_class text DEFAULT 'RETAIL'::text,
    certificate_hash text NOT NULL,
    certificate_signature text NOT NULL,
    status public.device_status_type DEFAULT 'ACTIVE'::public.device_status_type,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geo_code character varying(20)
);

CREATE SEQUENCE public.device_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.device_registry_id_seq OWNED BY public.device_registry.id;

CREATE TABLE public.device_trust_state (
    device_id character varying(16) NOT NULL,
    attestation_status character varying(20) DEFAULT 'UNVERIFIED'::character varying NOT NULL,
    attestation_token text,
    token_issued_at bigint,
    token_expiry bigint,
    last_attested_at bigint,
    firmware_hash text,
    secure_boot boolean DEFAULT false,
    key_epoch bigint DEFAULT 0,
    attested_public_key text,
    trust_score integer DEFAULT 100,
    failure_count integer DEFAULT 0,
    last_failure_reason text,
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.devices (
    id integer NOT NULL,
    device_id character varying(16) NOT NULL,
    public_key text,
    ledger_count integer DEFAULT 0,
    last_merkle_root text,
    last_seen timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    customer_id integer,
    issuer_id character varying(50),
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    firmware_version character varying(40),
    balance numeric(18,2) DEFAULT 0
);

CREATE SEQUENCE public.devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.devices_id_seq OWNED BY public.devices.id;

CREATE TABLE public.enterprise_accounts (
    enterprise_id character varying(50) NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.institutions (
    institution_id integer CONSTRAINT institutions_id_not_null NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    api_key text NOT NULL,
    public_key text,
    status text DEFAULT 'active'::text,
    created_at timestamp without time zone DEFAULT now()
);

CREATE SEQUENCE public.institutions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.institutions_id_seq OWNED BY public.institutions.institution_id;

CREATE TABLE public.regulator_directory (
    id bigint NOT NULL,
    regulator_code character varying(50) NOT NULL,
    regulator_name text NOT NULL,
    country_code character varying(10) NOT NULL,
    regulator_type character varying(40),
    remittance_account text,
    reporting_endpoint text,
    active boolean DEFAULT true,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);

CREATE SEQUENCE public.regulator_directory_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.regulator_directory_id_seq OWNED BY public.regulator_directory.id;

CREATE TABLE public.sync_state (
    id integer NOT NULL,
    device_id character varying(16),
    last_known_index integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now(),
    key text,
    value text
);

CREATE SEQUENCE public.sync_state_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sync_state_id_seq OWNED BY public.sync_state.id;

ALTER TABLE ONLY public.admin_roles ALTER COLUMN id SET DEFAULT nextval('public.admin_roles_id_seq'::regclass);

ALTER TABLE ONLY public.admin_users ALTER COLUMN id SET DEFAULT nextval('public.admin_users_id_seq'::regclass);

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);

ALTER TABLE ONLY public.certificate_records ALTER COLUMN id SET DEFAULT nextval('public.certificate_records_id_seq'::regclass);

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);

ALTER TABLE ONLY public.device_key_history ALTER COLUMN id SET DEFAULT nextval('public.device_key_history_id_seq'::regclass);

ALTER TABLE ONLY public.device_registry ALTER COLUMN id SET DEFAULT nextval('public.device_registry_id_seq'::regclass);

ALTER TABLE ONLY public.devices ALTER COLUMN id SET DEFAULT nextval('public.devices_id_seq'::regclass);

ALTER TABLE ONLY public.institutions ALTER COLUMN institution_id SET DEFAULT nextval('public.institutions_id_seq'::regclass);

ALTER TABLE ONLY public.regulator_directory ALTER COLUMN id SET DEFAULT nextval('public.regulator_directory_id_seq'::regclass);

ALTER TABLE ONLY public.sync_state ALTER COLUMN id SET DEFAULT nextval('public.sync_state_id_seq'::regclass);

ALTER TABLE ONLY public.admin_roles
    ADD CONSTRAINT admin_roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.admin_roles
    ADD CONSTRAINT admin_roles_role_code_key UNIQUE (role_code);

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.certificate_records
    ADD CONSTRAINT certificate_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_id_key UNIQUE (customer_id);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_key UNIQUE (phone);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.device_key_history
    ADD CONSTRAINT device_key_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.device_registry
    ADD CONSTRAINT device_registry_device_id_key UNIQUE (device_id);

ALTER TABLE ONLY public.device_registry
    ADD CONSTRAINT device_registry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.device_trust_state
    ADD CONSTRAINT device_trust_state_pkey PRIMARY KEY (device_id);

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_device_id_key UNIQUE (device_id);

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.enterprise_accounts
    ADD CONSTRAINT enterprise_accounts_pkey PRIMARY KEY (enterprise_id);

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_api_key_key UNIQUE (api_key);

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_pkey PRIMARY KEY (institution_id);

ALTER TABLE ONLY public.regulator_directory
    ADD CONSTRAINT regulator_directory_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.regulator_directory
    ADD CONSTRAINT regulator_directory_regulator_code_key UNIQUE (regulator_code);

ALTER TABLE ONLY public.sync_state
    ADD CONSTRAINT sync_state_pkey PRIMARY KEY (id);

CREATE INDEX idx_device_registry_device_id ON public.device_registry USING btree (device_id);

CREATE INDEX idx_devices_device_id ON public.devices USING btree (device_id);

CREATE INDEX idx_devices_last_seen ON public.devices USING btree (last_seen);

CREATE INDEX idx_inst_created ON public.institutions USING btree (created_at);

CREATE INDEX idx_inst_status ON public.institutions USING btree (status);

CREATE INDEX idx_inst_type ON public.institutions USING btree (type);

CREATE INDEX idx_registry_geo ON public.device_registry USING btree (geo_code);

CREATE INDEX idx_registry_issuer ON public.device_registry USING btree (issuer_id);

CREATE UNIQUE INDEX sync_state_key_unique ON public.sync_state USING btree (key);

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT fk_devices_customer FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
