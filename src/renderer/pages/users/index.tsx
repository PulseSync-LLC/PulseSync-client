import Layout from '../../components/layout'

import * as styles from './users.module.scss'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import { useEffect, useState } from 'react'
import UserInterface from '../../api/interfaces/user.interface'
import GetAllUsersQuery from '../../api/queries/user/getAllUsers.query'
import apolloClient from '../../api/apolloClient'
import toast from 'react-hot-toast-magic'

export default function UsersPage() {
    const [loading, setLoading] = useState(true);
    const [users, setUsers] = useState<UserInterface[]>([]);
    const [page, setPage] = useState(1);
    const [maxPages, setMaxPages] = useState(1);
    const [sorting, setSorting] = useState([
        { id: "createdAt", desc: true },
    ]);
    useEffect(() => {
        apolloClient
            .query({
                query: GetAllUsersQuery,
                variables: {
                    perPage: 30,
                    page,
                    sorting,
                },
            })
            .then((result) => {
                if (result.data) {
                    const data = result.data.getUsersWithPagination;

                    setLoading(false);
                    setUsers(data.users);
                    setMaxPages(data.totalPages);
                }
            })
            .catch((e) => {
                console.error(e);
                toast.error("Произошла ошибка!");
            });
    }, [sorting, page]);
    useEffect(() => {
        console.log(users);
    }, [users])
    return (
        <Layout title="Стилизация">
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        3
                    </div>
                </div>
            </div>
        </Layout>
    )

}
