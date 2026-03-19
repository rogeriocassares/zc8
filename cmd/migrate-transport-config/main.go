package main

import (
	"database/sql"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"

	_ "github.com/lib/pq"
)

func main() {
	// Get database URL from environment
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/transport_registry?sslmode=disable"
	}

	fmt.Printf("Connecting to database: %s\n", dbURL)

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	fmt.Println("✓ Database connection successful")

	// Check if tables exist
	fmt.Println("\n--- Checking for existing tables ---")
	tables := []string{"transport_mqtt_config", "transport_http_config", "transport_grpc_config"}
	for _, table := range tables {
		exists, err := tableExists(db, table)
		if err != nil {
			log.Fatalf("Error checking table %s: %v", table, err)
		}
		if exists {
			fmt.Printf("✓ Table %s exists\n", table)
		} else {
			fmt.Printf("✗ Table %s does NOT exist\n", table)
		}
	}

	// Read and apply migrations
	fmt.Println("\n--- Applying migrations ---")
	migrationsDir := "/Users/rogeriocassares/Git/rogeriocassares/zc8/infra/postgres/migrations"

	migrationFiles := []string{
		"005_transport_connection_config.sql",
		"006_migrate_transport_config_data.sql",
	}

	for _, filename := range migrationFiles {
		filepath := filepath.Join(migrationsDir, filename)
		fmt.Printf("\nApplying %s...\n", filename)

		content, err := ioutil.ReadFile(filepath)
		if err != nil {
			log.Fatalf("Failed to read %s: %v", filename, err)
		}

		_, err = db.Exec(string(content))
		if err != nil {
			// Don't fail on "already exists" errors
			log.Printf("Warning applying %s: %v\n", filename, err)
		} else {
			fmt.Printf("✓ %s applied successfully\n", filename)
		}
	}

	// Final verification
	fmt.Println("\n--- Final verification ---")
	for _, table := range tables {
		count, err := getTableRowCount(db, table)
		if err != nil {
			log.Printf("Error querying %s: %v", table, err)
		} else {
			fmt.Printf("✓ Table %s has %d rows\n", table, count)
		}
	}

	fmt.Println("\n✓ Migration complete!")
}

func tableExists(db *sql.DB, tableName string) (bool, error) {
	var exists bool
	query := `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables 
			WHERE table_schema = 'public' AND table_name = $1
		)
	`
	err := db.QueryRow(query, tableName).Scan(&exists)
	return exists, err
}

func getTableRowCount(db *sql.DB, tableName string) (int64, error) {
	var count int64
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s", tableName)
	err := db.QueryRow(query).Scan(&count)
	return count, err
}
