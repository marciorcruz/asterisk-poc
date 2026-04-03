package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const ctxUserID ctxKey = "userID"

func generateToken(userID int64) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": strconv.FormatInt(userID, 10),
		"exp": time.Now().Add(30 * 24 * time.Hour).Unix(),
	})
	return token.SignedString(jwtSecret)
}

func parseToken(raw string) (int64, error) {
	t, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return jwtSecret, nil
	})
	if err != nil || !t.Valid {
		return 0, jwt.ErrSignatureInvalid
	}
	claims, ok := t.Claims.(jwt.MapClaims)
	if !ok {
		return 0, jwt.ErrSignatureInvalid
	}
	sub, err := claims.GetSubject()
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(sub, 10, 64)
}

func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		raw := strings.TrimPrefix(header, "Bearer ")
		if raw == "" {
			jsonErr(w, "não autenticado", http.StatusUnauthorized)
			return
		}
		userID, err := parseToken(raw)
		if err != nil {
			jsonErr(w, "token inválido", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), ctxUserID, userID)
		next(w, r.WithContext(ctx))
	}
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
