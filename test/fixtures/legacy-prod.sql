-- Base "production" simulée : schéma créé par le code d'avant P3.6 (81d8261),
-- puis démarrage du code P3.6 (ecb27c1), qui a ajouté une table price_history
-- incomplète. Contient 3 utilisateurs (mots de passe initiaux), le catalogue
-- initial et une commande à crédit. Sert à vérifier que initDB() migre une
-- base existante sans perte. Généré avec pg_dump --inserts.

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id integer NOT NULL,
    action text NOT NULL,
    entity text,
    entity_id integer,
    detail text DEFAULT ''::text,
    user_name text NOT NULL,
    user_role text NOT NULL,
    created_at text NOT NULL
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;


--
-- Name: catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog (
    id integer NOT NULL,
    name text NOT NULL,
    price integer NOT NULL,
    price_express integer DEFAULT 0,
    icon text DEFAULT '🧺'::text,
    active boolean DEFAULT true,
    category text DEFAULT 'Divers'::text
);


--
-- Name: catalog_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.catalog_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: catalog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.catalog_id_seq OWNED BY public.catalog.id;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id integer NOT NULL,
    name text NOT NULL,
    phone text DEFAULT ''::text,
    email text DEFAULT ''::text,
    address text DEFAULT ''::text,
    notes text DEFAULT ''::text
);


--
-- Name: clients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clients_id_seq OWNED BY public.clients.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    code text NOT NULL,
    type text NOT NULL,
    client_id integer,
    client_name text NOT NULL,
    phone text DEFAULT ''::text,
    items jsonb,
    weight numeric(10,2),
    price_kg integer,
    kilo_items text,
    subtotal integer NOT NULL,
    discount integer DEFAULT 0 NOT NULL,
    discount_reason text,
    total integer NOT NULL,
    status text DEFAULT 'depose'::text NOT NULL,
    payment_mode text NOT NULL,
    promise_date text,
    day text NOT NULL,
    created_at text NOT NULL,
    created_by text NOT NULL,
    delivered_at text,
    invoice_no text,
    track_token text,
    CONSTRAINT orders_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['Espèces'::text, 'Mobile Money'::text, 'Crédit'::text]))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['depose'::text, 'traitement'::text, 'pret'::text, 'livre'::text, 'annule'::text]))),
    CONSTRAINT orders_type_check CHECK ((type = ANY (ARRAY['article'::text, 'kilo'::text])))
);


--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    order_id integer NOT NULL,
    amount integer NOT NULL,
    method text NOT NULL,
    created_at text NOT NULL,
    created_by text NOT NULL,
    CONSTRAINT payments_amount_check CHECK ((amount > 0)),
    CONSTRAINT payments_method_check CHECK ((method = ANY (ARRAY['Espèces'::text, 'Mobile Money'::text])))
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_history (
    id integer NOT NULL,
    catalog_id integer,
    old_price numeric,
    new_price numeric,
    changed_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.price_history_id_seq OWNED BY public.price_history.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text
);


--
-- Name: status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_history (
    id integer NOT NULL,
    order_id integer NOT NULL,
    old_status text,
    new_status text NOT NULL,
    changed_at text NOT NULL,
    changed_by text NOT NULL,
    note text
);


--
-- Name: status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.status_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.status_history_id_seq OWNED BY public.status_history.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id integer NOT NULL,
    client_id integer NOT NULL,
    plan_name text NOT NULL,
    total_articles integer NOT NULL,
    used_articles integer DEFAULT 0 NOT NULL,
    amount_paid integer DEFAULT 0 NOT NULL,
    start_date text NOT NULL,
    end_date text NOT NULL,
    status text DEFAULT 'actif'::text NOT NULL,
    created_at text NOT NULL,
    created_by text NOT NULL,
    notes text DEFAULT ''::text,
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['actif'::text, 'expiré'::text, 'épuisé'::text, 'annulé'::text]))),
    CONSTRAINT subscriptions_total_articles_check CHECK ((total_articles > 0))
);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    pwd text NOT NULL,
    must_change boolean DEFAULT true,
    active boolean DEFAULT true,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['caissier'::text, 'superviseur'::text, 'gerant'::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);


--
-- Name: catalog id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog ALTER COLUMN id SET DEFAULT nextval('public.catalog_id_seq'::regclass);


--
-- Name: clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients ALTER COLUMN id SET DEFAULT nextval('public.clients_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: price_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history ALTER COLUMN id SET DEFAULT nextval('public.price_history_id_seq'::regclass);


--
-- Name: status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_history ALTER COLUMN id SET DEFAULT nextval('public.status_history_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: activity_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.activity_log VALUES (1, 'login', 'user', 1, 'Connexion depuis 127.0.0.1', 'Gérant', 'gerant', '2026-11-27T14:05:49.961Z');
INSERT INTO public.activity_log VALUES (2, 'create_order', 'order', 1, 'LP-261127-0001 — Awa — 2000 FCFA', 'Gérant', 'gerant', '2026-11-27T14:05:49.984Z');
INSERT INTO public.activity_log VALUES (3, 'login', 'user', 1, 'Connexion depuis 127.0.0.1', 'Gérant', 'gerant', '2026-11-27T14:06:01.427Z');


--
-- Data for Name: catalog; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog VALUES (1, 'CHEMISE / H', 1000, 2000, '👔', true, 'Hauts');
INSERT INTO public.catalog VALUES (2, 'PANTALON', 1000, 2000, '👖', true, 'Bas');
INSERT INTO public.catalog VALUES (3, 'ROBE SIMPLE', 2500, 5000, '👗', true, 'Robes');
INSERT INTO public.catalog VALUES (4, 'COSTUME 2P', 3000, 6000, '🤵', true, 'Costumes');
INSERT INTO public.catalog VALUES (5, 'VESTE / H', 2200, 2500, '🧥', true, 'Hauts');
INSERT INTO public.catalog VALUES (6, 'JUPE SIMPLE', 1000, 2000, '👗', true, 'Bas');
INSERT INTO public.catalog VALUES (7, 'POLO', 1000, 2000, '👔', true, 'Hauts');
INSERT INTO public.catalog VALUES (8, 'MANTEAU SIMPLE', 2500, 5000, '🧥', true, 'Manteaux');
INSERT INTO public.catalog VALUES (9, 'DRAP HOUSSE', 1000, 2000, '🛏️', true, 'Linge maison');
INSERT INTO public.catalog VALUES (10, 'PAIRE DE CHAUSSURES', 1500, 3000, '👟', true, 'Accessoires');
INSERT INTO public.catalog VALUES (11, 'CRAVATE', 1000, 2000, '🎀', true, 'Accessoires');
INSERT INTO public.catalog VALUES (12, 'COSTUME ENFANT', 2000, 4000, '🧒', true, 'Costumes');
INSERT INTO public.catalog VALUES (13, 'RIDEAU', 4000, 8000, '🪟', true, 'Linge maison');
INSERT INTO public.catalog VALUES (14, 'PULL-OVER', 1000, 2000, '🧶', true, 'Hauts');
INSERT INTO public.catalog VALUES (15, 'COUVERTURE / CVLT', 4500, 9000, '🛏️', true, 'Linge maison');


--
-- Data for Name: clients; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.clients VALUES (1, 'Awa', '690000000', '', '', '');


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.orders VALUES (1, 'LP-261127-0001', 'article', 1, 'Awa', '690000000', '[{"id": 1, "qty": 2, "icon": "👔", "name": "CHEMISE / H", "price": 1000, "express": false}]', NULL, NULL, NULL, 2000, 0, NULL, 2000, 'depose', 'Crédit', NULL, '2026-11-27', '2026-11-27T14:05:49.981Z', 'gerant', NULL, NULL, '0T-ENGDSxUy8sjTM');


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: price_history; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.settings VALUES ('invoice_seq', '1');
INSERT INTO public.settings VALUES ('invoice_logo', '');
INSERT INTO public.settings VALUES ('order_seq', '1');
INSERT INTO public.settings VALUES ('shop_address', '');
INSERT INTO public.settings VALUES ('shop_phone', '');
INSERT INTO public.settings VALUES ('shop_niu', '');
INSERT INTO public.settings VALUES ('default_delay', '2');
INSERT INTO public.settings VALUES ('max_discount_percent', '100');
INSERT INTO public.settings VALUES ('invoice_format', 'A6');
INSERT INTO public.settings VALUES ('invoice_header', '');
INSERT INTO public.settings VALUES ('invoice_footer', '');
INSERT INTO public.settings VALUES ('shop_name', 'Light Pressing');
INSERT INTO public.settings VALUES ('kilo_price', '700');


--
-- Data for Name: status_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.status_history VALUES (1, 1, NULL, 'depose', '2026-11-27T14:05:49.981Z', 'gerant', NULL);


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.users VALUES (1, 'gerant', 'Gérant', 'gerant', '1d7e4f4992f33df184fa3219c10820bc:1601b93ec01209befd7eab4d89575e91e68638b37135e0c304967e7503c4f37054785622849f3c867321dd5dde978b3a1f13fc3116039dbe4099f136b6ed0871', true, true);
INSERT INTO public.users VALUES (2, 'superviseur', 'Superviseur', 'superviseur', '154a0b8faddf74d13ed68fcfcb9d3941:441927d5bf5af12413ac7640553c2f6df0916543d200b99690ca61a38d8c5489bc703d40ec3ac620a4f1d640403ed3669bba90b2f8754ac96f7e2105bcb92aea', true, true);
INSERT INTO public.users VALUES (3, 'caissier', 'Caissier', 'caissier', '8eed81f54e6af85e56ec6dea54dbe49b:34da13932391b95d4dc42fa11f60bc49c68c0d32b36d6dc9d7b0f2c4719dc60db436ce6cc1303549c2dc43297093dae0997ae8d7be1c8f47553408494ed4dd61', true, true);


--
-- Name: activity_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.activity_log_id_seq', 3, true);


--
-- Name: catalog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.catalog_id_seq', 15, true);


--
-- Name: clients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.clients_id_seq', 1, true);


--
-- Name: orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.orders_id_seq', 1, true);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payments_id_seq', 1, false);


--
-- Name: price_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.price_history_id_seq', 1, false);


--
-- Name: status_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.status_history_id_seq', 1, true);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.subscriptions_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 3, true);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: catalog catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog
    ADD CONSTRAINT catalog_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: orders orders_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_code_key UNIQUE (code);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: orders orders_track_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_track_token_key UNIQUE (track_token);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: price_history price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: status_history status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_history
    ADD CONSTRAINT status_history_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_orders_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_client ON public.orders USING btree (client_id);


--
-- Name: idx_orders_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created ON public.orders USING btree (created_at);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: ix_actlog_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_actlog_created ON public.activity_log USING btree (created_at DESC);


--
-- Name: ix_orders_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orders_client ON public.orders USING btree (client_id);


--
-- Name: ix_orders_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orders_day ON public.orders USING btree (day);


--
-- Name: ix_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orders_status ON public.orders USING btree (status);


--
-- Name: ix_orders_track; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orders_track ON public.orders USING btree (track_token);


--
-- Name: ix_payments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payments_order ON public.payments USING btree (order_id);


--
-- Name: ix_sh_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sh_order ON public.status_history USING btree (order_id);


--
-- Name: ix_subs_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_subs_client ON public.subscriptions USING btree (client_id);


--
-- Name: orders orders_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: price_history price_history_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES public.catalog(id);


--
-- Name: status_history status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_history
    ADD CONSTRAINT status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: subscriptions subscriptions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- PostgreSQL database dump complete
--


