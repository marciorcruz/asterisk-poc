package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type User struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	Password    string `json:"-"`
	SIPPassword string `json:"-"`
	Extension   string `json:"extension"`
}

func initDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, err
	}
	conn, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, err
	}
	_, err = conn.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			name         TEXT    NOT NULL,
			email        TEXT    NOT NULL UNIQUE,
			password     TEXT    NOT NULL,
			sip_password TEXT    NOT NULL,
			extension    TEXT    NOT NULL UNIQUE,
			created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
		)`)
	return conn, err
}

func nextExtension(db *sql.DB) (string, error) {
	var max int
	err := db.QueryRow(
		`SELECT COALESCE(MAX(CAST(extension AS INTEGER)), 1999) FROM users`,
	).Scan(&max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d", max+1), nil
}

func createUser(db *sql.DB, u *User) error {
	res, err := db.Exec(
		`INSERT INTO users (name, email, password, sip_password, extension)
		 VALUES (?, ?, ?, ?, ?)`,
		u.Name, u.Email, u.Password, u.SIPPassword, u.Extension,
	)
	if err != nil {
		return err
	}
	u.ID, err = res.LastInsertId()
	return err
}

func getUserByEmail(db *sql.DB, email string) (*User, error) {
	u := &User{}
	err := db.QueryRow(
		`SELECT id, name, email, password, sip_password, extension
		 FROM users WHERE email = ?`, email,
	).Scan(&u.ID, &u.Name, &u.Email, &u.Password, &u.SIPPassword, &u.Extension)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func getUserByID(db *sql.DB, id int64) (*User, error) {
	u := &User{}
	err := db.QueryRow(
		`SELECT id, name, email, password, sip_password, extension
		 FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Name, &u.Email, &u.Password, &u.SIPPassword, &u.Extension)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func allUsers(db *sql.DB) ([]*User, error) {
	rows, err := db.Query(
		`SELECT id, name, email, password, sip_password, extension FROM users`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []*User
	for rows.Next() {
		u := &User{}
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Password, &u.SIPPassword, &u.Extension); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}
