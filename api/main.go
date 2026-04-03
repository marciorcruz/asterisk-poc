package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
)

var (
	db        *sql.DB
	jwtSecret []byte
	amiAddr   string
	amiUser   string
	amiSecret string
	confPath  string
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	var err error

	jwtSecret = []byte(env("JWT_SECRET", "dev-secret-mude-em-producao"))
	amiAddr = env("AMI_ADDR", "127.0.0.1:5038")
	amiUser = env("AMI_USER", "webphone")
	amiSecret = env("AMI_SECRET", "webphone123")
	confPath = env("PJSIP_USERS_CONF", "/etc/asterisk/pjsip_users.conf")

	db, err = initDB(env("DB_PATH", "/data/webphone.db"))
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer db.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/register", handleRegister)
	mux.HandleFunc("/api/login", handleLogin)
	mux.HandleFunc("/api/me", requireAuth(handleMe))

	addr := env("LISTEN", ":8080")
	log.Printf("API ouvindo em %s", addr)
	log.Fatal(http.ListenAndServe(addr, cors(mux)))
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
