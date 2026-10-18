import asyncio
from sqlalchemy import select
from app.database import AsyncSessionLocal, init_db
from app.models.customer import Customer

async def main():
    await init_db()
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Customer).limit(100))
        customers = result.scalars().all()
        print(f"Total customers in PostgreSQL: {len(customers)}")
        for c in customers:
            print(f"{c.customer_id}: name={c.name}, dtc={c.dtc_code}, lat={c.latitude}, lng={c.longitude}, status={c.status}")

if __name__ == "__main__":
    asyncio.run(main())
